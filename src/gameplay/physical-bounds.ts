import * as THREE from 'three';

/** Presentation annotations are inherited by descendants, not just mesh roots. */
export function hasAncestorFlag(object:THREE.Object3D,flag:'visualOnly'|'measureExclude',root?:THREE.Object3D):boolean {
  for(let current:THREE.Object3D|null=object;current;current=current.parent){
    if(current.userData[flag])return true;
    if(current===root)break;
  }
  return false;
}

/** Labels and callout lines must not enlarge the physical furniture envelope. */
export function physicalBounds(object:THREE.Object3D):THREE.Box3 {
  object.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3();
  object.traverse(node=>{
    if(!(node instanceof THREE.Mesh)||hasAncestorFlag(node,'measureExclude',object))return;
    if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();
    if(node.geometry.boundingBox)bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  return bounds;
}
