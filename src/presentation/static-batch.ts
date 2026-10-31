import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VisualResourcePool } from './visual-utils';

export interface StaticBatchStats { sourceMeshes: number; mergedMeshes: number }

/** Batch immutable decoration meshes only. Sources stay in place for diagnostics,
 * ownership and physical measurement; the merged copies are render-only.
 */
export function batchStaticRoomDecorations(root: THREE.Group, pool: VisualResourcePool): StaticBatchStats {
  const stats: StaticBatchStats = { sourceMeshes: 0, mergedMeshes: 0 };
  for (const group of [...root.children]) {
    if (!(group instanceof THREE.Group) || group.userData.dynamicDecoration) continue;
    group.updateWorldMatrix(true, true);
    const inverse = group.matrixWorld.clone().invert();
    const batches = new Map<string, { material: THREE.Material; renderOrder: number; parts: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[] }>();
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh || !object.visible) return;
      if (Array.isArray(object.material) || object.geometry.morphAttributes.position?.length) return;
      const signature = Object.keys(object.geometry.attributes).sort().join(',');
      const key = `${object.material.uuid}:${object.renderOrder}:${signature}`;
      const batch: { material: THREE.Material; renderOrder: number; parts: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[] } = batches.get(key) ?? { material: object.material, renderOrder: object.renderOrder, parts: [] };
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
      batch.parts.push({ mesh: object, geometry }); batches.set(key, batch);
    });
    for (const batch of batches.values()) {
      if (batch.parts.length < 2) { for (const part of batch.parts) part.geometry.dispose(); continue; }
      const geometry = mergeGeometries(batch.parts.map(part => part.geometry), false);
      for (const part of batch.parts) part.geometry.dispose();
      if (!geometry) continue;
      pool.own(geometry);
      const merged = new THREE.Mesh(geometry, batch.material);
      merged.name = `static-room-batch:${group.name}:${stats.mergedMeshes}`;
      merged.renderOrder = batch.renderOrder;
      merged.castShadow = merged.receiveShadow = true;
      merged.userData.measureExclude = true;
      merged.userData.staticBatch = true;
      group.add(merged);
      for (const part of batch.parts) part.mesh.visible = false;
      stats.sourceMeshes += batch.parts.length; stats.mergedMeshes++;
    }
  }
  return stats;
}
