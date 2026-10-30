import * as THREE from 'three';
import type { Pose } from '../contracts/game';

/** Art-replaceable articulated proxy. This owns no movement, hitboxes or gameplay facts. */
export interface CharacterVisual { root:THREE.Group; body:THREE.Object3D; head:THREE.Object3D; leftArm:THREE.Object3D; rightArm:THREE.Object3D; leftLeg:THREE.Object3D; rightLeg:THREE.Object3D; hand:THREE.Object3D; back:THREE.Object3D; crown:THREE.Object3D; chair:THREE.Group; update(pose:Pose,moving:boolean,sprint:boolean,time:number,holding:boolean):void }
const boxGeo=new THREE.BoxGeometry(1,1,1);
const sphereGeo=new THREE.SphereGeometry(1,12,8);
export function makeTechnicalCharacter(boss=false,tint=0xdde1d3):CharacterVisual {
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);
 const shirt=new THREE.MeshStandardMaterial({color:boss?0x293a37:tint,roughness:.88});
 const trousers=new THREE.MeshStandardMaterial({color:0x303b40,roughness:.95});
 const skin=new THREE.MeshStandardMaterial({color:0xd6ab8c,roughness:.88});
 const hair=new THREE.MeshStandardMaterial({color:0x252d2b,roughness:1});
 const dark=new THREE.MeshStandardMaterial({color:0x161e1c,roughness:.8});
 const accent=new THREE.MeshStandardMaterial({color:boss?0xd88f49:0x4e7f68,roughness:.75});
 function box(parent:THREE.Object3D,mat:THREE.Material,w:number,h:number,d:number,x:number,y:number,z:number){const m=new THREE.Mesh(boxGeo,mat);m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;}
 const torso=new THREE.Group();body.add(torso);box(torso,shirt,.43,.55,.24,0,0,0);torso.position.y=1.18;
 box(torso,accent,.06,.32,.02,0,.03,.14);box(torso,skin,.14,.1,.13,0,.32,0);
 const badge=box(torso,new THREE.MeshStandardMaterial({color:0xe9e9d7}),.1,.13,.015,.14,-.07,.14);
 box(badge,accent,.65,.2,.4,0,0,.4);
 const head=new THREE.Group();head.position.y=1.61;body.add(head);
 const face=new THREE.Mesh(sphereGeo,skin);face.scale.set(.17,.21,.16);head.add(face);
 const haircap=new THREE.Mesh(sphereGeo,hair);haircap.scale.set(.175,.10,.166);haircap.position.set(0,.14,-.01);head.add(haircap);
 box(head,dark,.035,.028,.018,-.065,.025,.148);box(head,dark,.035,.028,.018,.065,.025,.148);box(head,skin,.045,.055,.05,0,-.025,.17);box(head,dark,.07,.012,.016,0,-.095,.147);
 if(boss){box(head,dark,.14,.055,.025,-.075,.025,.16);box(head,dark,.14,.055,.025,.075,.025,.16);box(head,dark,.035,.012,.018,0,.025,.18);}
 function arm(side:number){const g=new THREE.Group();g.position.set(side*.29,1.39,0);body.add(g);box(g,shirt,.16,.36,.19,0,-.18,0);box(g,skin,.13,.29,.14,0,-.49,0);return g;}
 const leftArm=arm(-1),rightArm=arm(1);
 function leg(side:number){const g=new THREE.Group();g.position.set(side*.12,.91,0);body.add(g);box(g,trousers,.19,.74,.2,0,-.37,0);box(g,dark,.21,.13,.33,0,-.82,.06);return g;}
 const leftLeg=leg(-1),rightLeg=leg(1);
 const hand=new THREE.Object3D();hand.position.set(0,-.61,.02);rightArm.add(hand);
 const back=new THREE.Object3D();back.position.set(0,1.27,-.2);body.add(back);
 const crown=new THREE.Object3D();crown.position.set(0,.25,0);head.add(crown);
 const chair=makeTechnicalChair();root.add(chair);
 return {root,body,head,leftArm,rightArm,leftLeg,rightLeg,hand,back,crown,chair,update(pose,moving,sprint,time,holding){
  const seated=pose==='working'||pose==='rolling';const crouch=pose==='crouching';
  body.position.y=seated?-.52:crouch?-.65:0;body.rotation.x=pose==='dragged'?-.15:crouch?.22:0;
  chair.visible=seated;
  const stride=moving?Math.sin(time*(sprint?14:9))*(sprint?.7:.43):0;
  leftLeg.rotation.x=seated?-1.25+(moving?stride*.18:0):crouch?-.65:stride;
  rightLeg.rotation.x=seated?-1.25-(moving?stride*.18:0):crouch?-.65:-stride;
  leftLeg.position.y=rightLeg.position.y=crouch?.75:.91;
  leftArm.rotation.x=pose==='working'?-1.02+Math.sin(time*15)*.04:seated?-.5:-stride*.65;
  rightArm.rotation.x=holding?-1.15:pose==='working'?-1.02-Math.sin(time*15)*.04:seated?-.5:stride*.65;
  head.rotation.y=pose==='working'?Math.sin(time*.7)*.1:0;
 }};
}
export function makeTechnicalChair(){const g=new THREE.Group();const mat=new THREE.MeshStandardMaterial({color:0x253e36,roughness:.85});const metal=new THREE.MeshStandardMaterial({color:0x434c49,metalness:.5,roughness:.5});
 function b(w:number,h:number,d:number,x:number,y:number,z:number,m=mat){const o=new THREE.Mesh(boxGeo,m);o.scale.set(w,h,d);o.position.set(x,y,z);o.castShadow=true;g.add(o);}
 b(.57,.12,.52,0,.48,0);b(.55,.6,.1,0,.84,-.25);b(.08,.35,.08,0,.25,0,metal);
 for(const side of [-1,1]){b(.06,.05,.42,side*.34,.68,0);b(.04,.22,.04,side*.34,.56,0,metal);b(.65,.035,.04,0,.1,side*.2,metal);for(const z of [-.22,.22]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.045,8),metal);wheel.rotation.z=Math.PI/2;wheel.position.set(side*.28,.065,z);g.add(wheel);}}
 return g;
}
export function makeTechnicalPot(){const g=new THREE.Group(),m=new THREE.MeshStandardMaterial({color:0x283534,metalness:.65,roughness:.38});const bowl=new THREE.Mesh(new THREE.CylinderGeometry(.225,.18,.11,20,1,false),m);g.add(bowl);const inner=new THREE.Mesh(new THREE.CylinderGeometry(.205,.205,.012,20),new THREE.MeshStandardMaterial({color:0x101817,metalness:.2,roughness:.8}));inner.position.y=.061;g.add(inner);const handle=new THREE.Mesh(boxGeo,m);handle.scale.set(.075,.045,.28);handle.position.set(0,.02,.33);g.add(handle);return g;}
