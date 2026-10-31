import * as THREE from 'three';

/** Geometry, material and texture ownership for one visual module instance. */
export class VisualResourcePool {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private resources = new Set<{ dispose(): void }>();

  box(width: number, height: number, depth: number): THREE.BoxGeometry {
    return this.geometry(`box:${width}:${height}:${depth}`, () => new THREE.BoxGeometry(width, height, depth));
  }

  cylinder(radiusTop: number, radiusBottom: number, height: number, segments = 20): THREE.CylinderGeometry {
    return this.geometry(`cylinder:${radiusTop}:${radiusBottom}:${height}:${segments}`, () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments));
  }

  plane(width: number, height: number): THREE.PlaneGeometry {
    return this.geometry(`plane:${width}:${height}`, () => new THREE.PlaneGeometry(width, height));
  }

  geometry<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
    const cached = this.geometries.get(key);
    if (cached) return cached as T;
    const geometry = create();
    this.geometries.set(key, geometry);
    this.resources.add(geometry);
    return geometry;
  }

  own<T extends { dispose(): void }>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  material(parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    return this.own(new THREE.MeshStandardMaterial(parameters));
  }

  basic(parameters: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    return this.own(new THREE.MeshBasicMaterial(parameters));
  }

  dispose(): void {
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.geometries.clear();
  }
}

export function addBox(
  parent: THREE.Object3D,
  pool: VisualResourcePool,
  material: THREE.Material,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  rotationY = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(pool.box(...size), material);
  mesh.position.set(...position);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function addCylinder(
  parent: THREE.Object3D,
  pool: VisualResourcePool,
  material: THREE.Material,
  radii: readonly [number, number],
  height: number,
  position: readonly [number, number, number],
  segments = 20,
): THREE.Mesh {
  const mesh = new THREE.Mesh(pool.cylinder(radii[0], radii[1], height, segments), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export interface LabelOptions {
  width?: number;
  height?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  foreground?: string;
  background?: string;
  accent?: string;
  fontSize?: number;
  align?: CanvasTextAlign;
  padding?: number;
  lines?: string[];
  transparent?: boolean;
  emissive?: boolean;
}

/** Canvas labels stay sharp at office-reading distances and require no external font asset. */
export function makeLabel(
  pool: VisualResourcePool,
  text: string,
  options: LabelOptions = {},
): THREE.Mesh {
  const width = options.width ?? 1;
  const height = options.height ?? .25;
  const pixelWidth = options.pixelWidth ?? 768;
  const pixelHeight = options.pixelHeight ?? Math.max(128, Math.round(pixelWidth * height / width));
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext('2d')!;
  const background = options.background ?? '#e8e2d2';
  const transparent = options.transparent ?? background === 'transparent';
  if (!transparent) {
    context.fillStyle = background;
    context.fillRect(0, 0, pixelWidth, pixelHeight);
  }
  if (options.accent) {
    context.fillStyle = options.accent;
    context.fillRect(0, 0, Math.max(8, pixelWidth * .018), pixelHeight);
  }
  const lines = options.lines ?? text.split('\n');
  const fontSize = options.fontSize ?? Math.min(64, pixelHeight / (lines.length + .7));
  const padding = options.padding ?? Math.round(fontSize * .55);
  context.fillStyle = options.foreground ?? '#252922';
  context.font = `600 ${fontSize}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
  context.textAlign = options.align ?? 'center';
  context.textBaseline = 'middle';
  const x = context.textAlign === 'left' ? padding : context.textAlign === 'right' ? pixelWidth - padding : pixelWidth / 2;
  const lineHeight = fontSize * 1.2;
  const firstY = pixelHeight / 2 - (lines.length - 1) * lineHeight / 2;
  lines.forEach((line, index) => context.fillText(line, x, firstY + index * lineHeight, pixelWidth - padding * 2));
  const texture = pool.own(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = options.emissive
    ? pool.material({ map: texture, transparent, side: THREE.DoubleSide, emissive: new THREE.Color(options.foreground ?? '#ffffff'), emissiveMap: texture, emissiveIntensity: .35, roughness: .9 })
    : pool.basic({ map: texture, transparent, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(pool.plane(width, height), material);
  mesh.userData.visualOnly = true;
  return mesh;
}

export function makeDeterministicRandom(key: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < key.length; index++) {
    state ^= key.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findDescendant(root: THREE.Object3D, ...candidates: string[]): THREE.Object3D | undefined {
  const wanted = candidates.map(normalizedName);
  let result: THREE.Object3D | undefined;
  root.traverse(object => {
    if (!result && wanted.includes(normalizedName(object.name))) result = object;
  });
  return result;
}

/** Measures the current rendered pose, including skinned vertices rather than the bind-pose box. */
export function measureVisualBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const result = new THREE.Box3();
  result.makeEmpty();
  root.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) {
      object.computeBoundingBox();
      result.union(object.boundingBox.clone().applyMatrix4(object.matrixWorld));
    } else if (object instanceof THREE.Mesh) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      result.union(object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return result;
}

export function disposeDetachedObject(root: THREE.Object3D): void {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  for (const skeleton of skeletons) skeleton.dispose();
  root.removeFromParent();
}
