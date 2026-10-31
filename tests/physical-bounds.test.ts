import { expect,it } from 'vitest';
import * as THREE from 'three';
import { hasAncestorFlag,physicalBounds } from '../src/gameplay/physical-bounds';

it('does not turn inherited annotation geometry into a furniture obstacle',()=>{
  const root=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(2,1,1));
  body.position.y=.5;root.add(body);root.position.set(4,0,7);root.rotation.y=Math.PI/2;
  const annotation=new THREE.Group();annotation.userData.measureExclude=true;annotation.userData.visualOnly=true;
  const label=new THREE.Mesh(new THREE.BoxGeometry(10,10,10));annotation.add(label);root.add(annotation);
  const bounds=physicalBounds(root),size=bounds.getSize(new THREE.Vector3());
  expect(size.toArray()).toEqual(expect.arrayContaining([1,2]));
  expect(size.x).toBeCloseTo(1);expect(size.y).toBeCloseTo(1);expect(size.z).toBeCloseTo(2);
  expect(bounds.min.x).toBeCloseTo(3.5);expect(bounds.max.y).toBeCloseTo(1);
  expect(hasAncestorFlag(label,'visualOnly',root)).toBe(true);
  expect(hasAncestorFlag(body,'visualOnly',root)).toBe(false);
  body.geometry.dispose();label.geometry.dispose();
});
