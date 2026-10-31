/** Shared visual tokens. Presentation only: no game rules or authoritative state. */
export const ART_DIRECTION = {
  id: 'eighteen-hundred-institutional-realism',
  version: 2,
  palette: {
    ink: '#171915',
    olive: '#242820',
    paper: '#E6DDC7',
    fluorescent: '#CBD2B7',
    amber: '#D89A52',
    warning: '#C9796B',
  },
  materials: {
    desk: 'warm matte wood with restrained grain',
    seating: 'charcoal mesh and woven fabric',
    metal: 'brushed dark metal with soft edge highlights',
    wall: 'mineral gray paint with light baseboards',
  },
  lighting: {
    environment: 'cool residual daylight; silhouettes remain readable',
    practical: 'warm fluorescent pools; no heavy vignette',
    darkRoom: 'retain floor, door frames, switches and character edges',
  },
  motion: {
    buttonMs: 160,
    overlayMs: 220,
    declarationInMs: 200,
    declarationOutMs: 300,
  },
} as const;

export const ASSET_CONTRACTS = {
  'leader-v1': { height: 1.85, up: '+Y', forward: '+Z', origin: 'feet-center' },
  'pot-v1': { diameter: 0.45, up: '+Y', forward: '+Z', origin: 'bowl-center-bottom' },
  'chair-v1': { seatHeight: 0.50, height: 1.10, up: '+Y', forward: '+Z', origin: 'floor-center' },
  'computer-set-v1': { size: [0.80, 0.50, 0.45], up: '+Y', forward: '+Z', origin: 'bottom-center' },
  'cake-v1': { size: [0.60, 0.40, 0.60], up: '+Y', forward: '+Z', origin: 'bottom-center' },
  'box-v1': { size: [0.55, 0.55, 0.55], up: '+Y', forward: '+Z', origin: 'bottom-center' },
  'clock-station-v1': { size: [0.50, 1.23, 0.36], up: '+Y', forward: '+Z', origin: 'floor-center' },
  'exit-door-v1': { size: [2.18, 2.28, 0.12], up: '+Y', forward: '+Z', origin: 'floor-center' },
  'printer-v1': { size: [0.88, 0.48, 0.30], up: '+Y', forward: '+Z', origin: 'bottom-center' },
  'plant-v1': { size: [0.34, 1.15, 0.34], up: '+Y', forward: '+Z', origin: 'floor-center' },
  'storage-shelf-v1': { size: [2.10, 1.82, 0.28], up: '+Y', forward: '+Z', origin: 'floor-center' },
} as const;
