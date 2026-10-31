import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { VisualResourcePool, addBox, addCylinder, makeDeterministicRandom, makeLabel } from './visual-utils';

export interface SignSpec {
  text: string;
  width: number;
  height: number;
  lines?: string[];
  fontSize?: number;
  background?: string;
  foreground?: string;
  accent?: string;
  frame?: boolean;
}

/** Scene-local construction kit. It owns no game state and shares no mutable materials with other modules. */
export class RoomDecorationKit {
  readonly materials: Record<string, THREE.MeshStandardMaterial>;
  readonly floorMaterial: THREE.MeshStandardMaterial;
  readonly wallMaterial: THREE.MeshStandardMaterial;
  readonly contactMaterial: THREE.MeshBasicMaterial;

  constructor(readonly pool: VisualResourcePool) {
    const wood = this.texture('old-walnut', '#a78962', (context, random) => {
      for (let index = 0; index < 90; index++) {
        context.strokeStyle = `rgba(61,43,28,${.025 + random() * .09})`;
        context.lineWidth = .6 + random() * 1.5;
        const y = random() * 256;
        context.beginPath();
        context.moveTo(0, y);
        context.bezierCurveTo(70, y + random() * 8, 180, y - random() * 9, 256, y + random() * 4);
        context.stroke();
      }
    });
    const fabric = this.texture('woven-sage', '#596c64', (context, random) => {
      context.lineWidth = 1;
      for (let line = 0; line < 256; line += 4) {
        context.strokeStyle = line % 8 ? 'rgba(232,225,202,.07)' : 'rgba(21,38,31,.09)';
        context.beginPath(); context.moveTo(line, 0); context.lineTo(line, 256); context.stroke();
        context.beginPath(); context.moveTo(0, line); context.lineTo(256, line); context.stroke();
      }
      for (let index = 0; index < 500; index++) {
        context.fillStyle = `rgba(236,225,196,${random() * .08})`;
        context.fillRect(random() * 256, random() * 256, 1, 1);
      }
    });
    const cork = this.texture('cork-grain', '#9f8059', (context, random) => {
      for (let index = 0; index < 2800; index++) {
        const light = random() > .52;
        context.fillStyle = light ? `rgba(229,202,151,${.08 + random() * .2})` : `rgba(57,41,25,${.06 + random() * .19})`;
        const size = .5 + random() * 2.1;
        context.fillRect(random() * 256, random() * 256, size * 1.7, size);
      }
    });
    const carpet = this.texture('carpet-rib', '#52645b', (context, random) => {
      for (let y = 0; y < 256; y += 3) {
        context.fillStyle = y % 6 ? 'rgba(226,219,185,.035)' : 'rgba(21,35,29,.065)';
        context.fillRect(0, y, 256, 1);
      }
      for (let index = 0; index < 800; index++) {
        context.fillStyle = `rgba(224,212,176,${random() * .06})`;
        context.fillRect(random() * 256, random() * 256, 1, 2);
      }
    });
    const floorTexture = this.texture('commercial-floor', '#707a70', (context, random) => {
      for (let line = 0; line <= 256; line += 64) {
        context.strokeStyle = 'rgba(34,45,38,.12)'; context.lineWidth = 1;
        context.beginPath(); context.moveTo(line, 0); context.lineTo(line, 256); context.stroke();
        context.beginPath(); context.moveTo(0, line); context.lineTo(256, line); context.stroke();
      }
      for (let index = 0; index < 5200; index++) {
        context.fillStyle = random() > .5 ? `rgba(225,226,205,${random() * .055})` : `rgba(35,47,39,${random() * .05})`;
        const size = .4 + random() * 1.1;
        context.fillRect(random() * 256, random() * 256, size, size);
      }
    }, 512);
    const wallTexture = this.texture('painted-wall', '#879187', (context, random) => {
      for (let index = 0; index < 6200; index++) {
        context.fillStyle = random() > .48 ? `rgba(229,229,211,${random() * .045})` : `rgba(42,52,44,${random() * .04})`;
        context.fillRect(random() * 256, random() * 256, .7, .7);
      }
      for (let index = 0; index < 26; index++) {
        context.strokeStyle = `rgba(48,53,43,${.015 + random() * .035})`; context.lineWidth = .5 + random();
        const x = random() * 256, y = 196 + random() * 60;
        context.beginPath(); context.moveTo(x, y); context.lineTo(x + random() * 18, y + random() * 3); context.stroke();
      }
    }, 512);
    const contactTexture = this.texture('contact-shadow', '#000000', context => {
      const gradient = context.createRadialGradient(128, 128, 18, 128, 128, 126);
      gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.55, 'rgba(255,255,255,.48)'); gradient.addColorStop(1, '#000000');
      context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
    });
    const woodData = this.dataTexture(wood), fabricData = this.dataTexture(fabric), corkData = this.dataTexture(cork), carpetData = this.dataTexture(carpet);
    const floorData = this.dataTexture(floorTexture), wallData = this.dataTexture(wallTexture);
    wood.wrapS = wood.wrapT = fabric.wrapS = fabric.wrapT = cork.wrapS = cork.wrapT = carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(2, 2); fabric.repeat.set(3, 3); cork.repeat.set(2, 2); carpet.repeat.set(4, 4);
    this.materials = {
      paint: this.material('decor.paint.sage', { color: 0x879087, roughness: .86, bumpMap: corkData, bumpScale: .0015 }),
      edge: this.material('decor.edge.pale', { color: 0xc4c8b9, roughness: .8, bumpMap: corkData, bumpScale: .001 }),
      dark: this.material('decor.dark.graphite', { color: 0x303b37, roughness: .69, metalness: .13 }),
      acrylic: this.material('decor.acrylic.company', { color: 0x24372f, roughness: .28, metalness: .2 }),
      wood: this.material('decor.wood.walnut', { color: 0xffffff, map: wood, roughnessMap: woodData, roughness: .82, bumpMap: woodData, bumpScale: .006, metalness: .02 }),
      brass: this.material('decor.metal.champagne', { color: 0xc6a065, roughness: .4, metalness: .64 }),
      metal: this.material('decor.metal.powdercoat', { color: 0x77817a, roughness: .62, metalness: .08, bumpMap: fabricData, bumpScale: .002 }),
      paper: this.material('decor.paper.ivory', { color: 0xe8e1ce, roughness: .97, bumpMap: corkData, bumpScale: .0015 }),
      fabric: this.material('decor.fabric.sage', { color: 0xffffff, map: fabric, roughnessMap: fabricData, roughness: .96, bumpMap: fabricData, bumpScale: .008 }),
      cork: this.material('decor.cork.pinboard', { color: 0xffffff, map: cork, roughnessMap: corkData, roughness: .96, bumpMap: corkData, bumpScale: .01 }),
      carpet: this.material('decor.carpet.ribbed', { color: 0xffffff, map: carpet, roughnessMap: carpetData, roughness: .98, bumpMap: carpetData, bumpScale: .012 }),
      whiteboard: this.material('decor.whiteboard.enamel', { color: 0xdde1d4, roughness: .32, metalness: .04, bumpMap: corkData, bumpScale: .0005 }),
      red: this.material('decor.accent.oxide', { color: 0x9b5547, roughness: .8 }),
      green: this.material('decor.accent.green', { color: 0x476c5a, roughness: .82 }),
      yellow: this.material('decor.accent.note', { color: 0xd4bb70, roughness: .93 }),
      ceramic: this.material('decor.ceramic.warm', { color: 0xd9d5c5, roughness: .35 }),
    };
    floorTexture.wrapS = floorTexture.wrapT = wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(2.4, 4.5); wallTexture.repeat.set(3, 1);
    floorData.repeat.copy(floorTexture.repeat); wallData.repeat.copy(wallTexture.repeat);
    this.floorMaterial = this.pool.material({ map: floorTexture, roughnessMap: floorData, bumpMap: floorData, bumpScale: .006, roughness: .93, color: 0xffffff });
    this.floorMaterial.name = 'decor.floor.commercial';
    this.wallMaterial = this.pool.material({ map: wallTexture, roughnessMap: wallData, bumpMap: wallData, bumpScale: .003, roughness: .9, color: 0xffffff });
    this.wallMaterial.name = 'decor.wall.painted';
    this.contactMaterial = this.pool.own(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: contactTexture, transparent: true, opacity: .2, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.contactMaterial.name = 'decor.contact.ambient';
  }

  private material(name: string, parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const material = this.pool.material(parameters);
    material.name = name;
    return material;
  }

  private texture(name: string, base: string, detail: (context: CanvasRenderingContext2D, random: () => number) => void, size = 256): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d')!;
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    context.scale(size / 256, size / 256);
    detail(context, makeDeterministicRandom(`room-decoration:${name}`));
    const texture = this.pool.own(new THREE.CanvasTexture(canvas));
    texture.name = `decor.texture.${name}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  private dataTexture(source: THREE.CanvasTexture): THREE.DataTexture {
    const canvas = source.image as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const texture = this.pool.own(new THREE.DataTexture(pixels, canvas.width, canvas.height, THREE.RGBAFormat, THREE.UnsignedByteType));
    texture.name = `${source.name}.data`;
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = source.wrapS; texture.wrapT = source.wrapT;
    texture.repeat.copy(source.repeat); texture.anisotropy = Math.max(8, source.anisotropy);
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
    return texture;
  }

  rounded(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, size: readonly [number, number, number], position: readonly [number, number, number], radius = .025): THREE.Mesh {
    const safeRadius = Math.min(radius, Math.min(...size) * .45);
    const key = `decor-rounded:${size.join(':')}:${safeRadius}:1`;
    const geometry = this.pool.geometry(key, () => new RoundedBoxGeometry(...size, 1, safeRadius));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, size: readonly [number, number, number], position: readonly [number, number, number], rotationY = 0): THREE.Mesh {
    return addBox(parent, this.pool, material, size, position, rotationY);
  }

  cylinder(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, radii: readonly [number, number], height: number, position: readonly [number, number, number], segments = 16): THREE.Mesh {
    return addCylinder(parent, this.pool, material, radii, height, position, segments);
  }

  sign(spec: SignSpec): THREE.Group {
    const group = new THREE.Group();
    group.userData.visualOnly = true;
    const depth = spec.frame === false ? .018 : .045;
    const background = spec.background?.toLowerCase();
    const material = background === '#9f8059' ? this.materials.cork
      : background === '#dde1d4' ? this.materials.whiteboard
        : background && !['transparent', '#24372f', '#303b37'].includes(background) ? this.materials.paper
          : background === '#24372f' || background === '#303b37' ? this.materials.acrylic : this.materials.dark;
    this.rounded(group, material, [spec.width, spec.height, depth], [0, 0, 0], .022);
    if (spec.frame !== false) {
      const z = depth / 2 + .003;
      this.box(group, this.materials.brass, [spec.width - .045, .014, .009], [0, spec.height / 2 - .032, z]);
      this.box(group, this.materials.brass, [spec.width - .045, .014, .009], [0, -spec.height / 2 + .032, z]);
    }
    const label = makeLabel(this.pool, spec.text, {
      width: spec.width - .1,
      height: spec.height - .075,
      lines: spec.lines,
      fontSize: spec.fontSize ?? 58,
      foreground: spec.foreground ?? '#ece6d4',
      background: spec.background ?? 'transparent',
      accent: spec.accent,
      transparent: true,
      pixelWidth: spec.width > 2.5 ? 1400 : 1024,
      pixelHeight: Math.max(160, Math.round(1024 * spec.height / spec.width)),
    });
    label.position.z = depth / 2 + .007;
    group.add(label);
    return group;
  }

  cabinet(width: number, depth: number, height: number, doors = 2): THREE.Group {
    const group = new THREE.Group();
    this.rounded(group, this.materials.paint, [width, height - .09, depth], [0, (height - .09) / 2 + .07, 0], .035);
    this.rounded(group, this.materials.wood, [width + .035, .055, depth + .025], [0, height + .012, 0], .018);
    this.box(group, this.materials.dark, [width - .09, .08, depth - .055], [0, .04, 0]);
    for (let index = 0; index < doors; index++) {
      const x = -width / 2 + width / doors * (index + .5);
      const faceWidth = width / doors - .045;
      this.rounded(group, this.materials.edge, [faceWidth, height - .22, .022], [x, height / 2 + .015, depth / 2 + .012], .009);
      this.rounded(group, this.materials.dark, [.16, .023, .026], [x, height * .66, depth / 2 + .036], .008);
    }
    return group;
  }

  lowTable(width: number, depth: number, height = .69): THREE.Group {
    const group = new THREE.Group();
    this.rounded(group, this.materials.wood, [width, .065, depth], [0, height - .0325, 0], .028);
    this.box(group, this.materials.dark, [width - .14, .075, depth - .12], [0, height - .1, 0]);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      this.cylinder(group, this.materials.metal, [.025, .035], height - .13, [x * (width / 2 - .13), (height - .13) / 2, z * (depth / 2 - .13)], 10);
    }
    return group;
  }

  stool(): THREE.Group {
    const group = new THREE.Group();
    this.rounded(group, this.materials.fabric, [.46, .075, .43], [0, .45, 0], .035);
    const back = this.rounded(group, this.materials.fabric, [.45, .32, .055], [0, .71, -.19], .025);
    back.rotation.x = -.07;
    for (const x of [-.17, .17]) for (const z of [-.15, .15]) {
      this.cylinder(group, this.materials.dark, [.018, .023], .41, [x, .205, z], 8);
    }
    this.box(group, this.materials.dark, [.38, .025, .025], [0, .6, -.2]);
    return group;
  }

  bench(width = 1.35): THREE.Group {
    const group = new THREE.Group();
    this.rounded(group, this.materials.fabric, [width, .12, .52], [0, .44, 0], .045);
    for (const x of [-width / 2 + .13, width / 2 - .13]) for (const z of [-.18, .18]) {
      this.cylinder(group, this.materials.dark, [.022, .028], .39, [x, .195, z], 8);
    }
    this.rounded(group, this.materials.fabric, [width, .36, .07], [0, .68, -.225], .025);
    return group;
  }

  collaborationTable(width = 2.4, depth = .85): THREE.Group {
    return this.lowTable(width, depth, .69);
  }

  displayPanel(spec: SignSpec & { accent: string }): THREE.Group {
    return this.sign({ ...spec, frame: true, background: spec.background ?? '#dde1d4' });
  }

  shelf(width: number, depth: number, height: number, levels = 4): THREE.Group {
    const group = new THREE.Group();
    for (const x of [-width / 2 + .035, width / 2 - .035]) for (const z of [-depth / 2 + .025, depth / 2 - .025]) {
      this.box(group, this.materials.metal, [.045, height, .045], [x, height / 2, z]);
    }
    for (let index = 0; index < levels; index++) {
      const y = .12 + (height - .18) * index / (levels - 1);
      this.rounded(group, this.materials.paint, [width, .035, depth], [0, y, 0], .009);
    }
    return group;
  }

  rug(width: number, depth: number): THREE.Group {
    const group = new THREE.Group();
    group.userData.visualOnly = true;
    group.userData.measureExclude = true;
    this.rounded(group, this.materials.carpet, [width, .012, depth], [0, .006, 0], .005);
    for (const z of [-depth / 2 + .075, depth / 2 - .075]) {
      this.box(group, this.materials.brass, [width - .12, .002, .014], [0, .013, z]);
    }
    return group;
  }

  formTray(width = .42): THREE.Group {
    const group = new THREE.Group();
    group.userData.visualOnly = true;
    for (let index = 0; index < 3; index++) {
      this.box(group, this.materials.dark, [width, .018, .3], [0, .035 + index * .075, 0]);
      this.box(group, this.materials.paper, [width - .045, .003, .255], [0, .046 + index * .075, -.006]);
    }
    for (const x of [-width / 2 + .012, width / 2 - .012]) this.box(group, this.materials.metal, [.018, .2, .025], [x, .1, -.135]);
    return group;
  }

  paper(width = .21, depth = .29): THREE.Mesh {
    const mesh = this.box(new THREE.Group(), this.materials.paper, [width, .003, depth], [0, 0, 0]);
    mesh.removeFromParent();
    mesh.userData.visualOnly = true;
    return mesh;
  }

  wallClock(): THREE.Group {
    const group = new THREE.Group();
    group.userData.visualOnly = true;
    const dial = this.cylinder(group, this.materials.paper, [.25, .25], .035, [0, 0, 0], 40);
    dial.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(this.pool.geometry('decor-clock-rim', () => new THREE.TorusGeometry(.25, .018, 8, 40)), this.materials.brass);
    rim.position.z = .025;
    group.add(rim);
    const hour = this.box(group, this.materials.dark, [.018, .12, .012], [0, .045, .03]);
    hour.rotation.z = -.52;
    const minute = this.box(group, this.materials.dark, [.014, .18, .012], [.065, .04, .032]);
    minute.rotation.z = 1.05;
    return group;
  }
}
