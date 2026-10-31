export type Vec2 = { x: number; z: number };
export type Page = 'home' | 'tutorial' | 'settings' | 'loading' | 'ready' | 'playing' | 'paused' | 'result' | 'error';
export type Ending = 'escaped' | 'overtime' | 'fired';
export type RuleKind = 'cake' | 'desk' | 'pot' | 'return' | 'flow' | 'transparent' | 'pressure';
export type Pose = 'standing' | 'crouching' | 'working' | 'rolling' | 'dragged';
export interface Rect { x: number; z: number; w: number; d: number }
/** World-space AABB of a static visual solid, extending from ground level to height. */
export interface StaticDecorationCollider extends Rect { id: string; roomId: number; height: number }
export interface Wall extends Rect { id: string; height: number; roomId: number; transparent?: boolean; partition?: boolean; crawl?: boolean }
export interface Room extends Rect { id: number; name: string; kind: string; lit: boolean; permanentLight: boolean; switch: Vec2 & {wallId?:string;yaw?:number}; pressure: boolean }
export interface Door extends Vec2 { id: string; a: number; b: number; axis: 'x' | 'z'; width: number; crawl?: boolean }
export interface Desk extends Vec2 { id: string; roomId: number; seat: Vec2; yaw: number; home?: boolean }
export interface Station extends Vec2 { id: string; roomId: number; yaw: number }
export interface Exit extends Station { outward: Vec2 }
export interface Prop extends Vec2 { id: string; kind: 'box' | 'cake'; roomId: number }
export interface ColleagueDef extends Vec2 { id: string; name: string; deskId: string; roomId: number; yaw: number; pot: boolean }
export interface WorldDef { seed: number; rooms: Room[]; walls: Wall[]; doors: Door[]; desks: Desk[]; stations: Station[]; exits: Exit[]; props: Prop[]; colleagues: ColleagueDef[]; spawn: Vec2; bossSpawn: Vec2; patrol: Vec2[]; width: number; depth: number; validation: string[]; decorationColliders?: StaticDecorationCollider[] }
export interface Player extends Vec2 { y: number; vy: number; yaw: number; pose: Pose; sticky: boolean; stamina: number; potId: string | null; holding: string | null; potInHand: boolean; protection: number; crouchIntent: boolean; moving: boolean; sprinting: boolean }
export interface Boss extends Vec2 { yaw: number; mode: 'patrol' | 'warning' | 'chase' | 'search' | 'drag' | 'leave'; lastSeen: Vec2 | null; evidenceUntil: number; evidenceId: string | null; seenFor: number; contactFor: number; searchFor: number; path: Vec2[]; patrolIndex: number }
export interface Pot { id: string; owner: string; phase: 'attached' | 'drawing' | 'held' | 'flying' | 'returning' | 'attaching'; cooldown: number; progress: number; from: Vec2; to: Vec2; targetId: string | null }
export interface PropState extends Prop { held: boolean; large: boolean; scale: number; y?: number }
export interface Colleague extends ColleagueDef { grudge: boolean; seenFor: number; reportAt: number | null; reportPosition: Vec2 | null; cooldown: number }
export interface ActiveRule { id: number; kind: RuleKind; quote: string; effect: string; targetId: string; roomId: number; phase: 'warning' | 'active' | 'restoring'; remaining: number; duration: number; age: number }
export interface Interaction { id: string; kind: 'stand' | 'sit' | 'light' | 'clock' | 'exit' | 'prop' | 'push'; label: string; duration: number; progress: number }
export interface GameState { seed: number; elapsed: number; remaining: number; ending: Ending | null; clocked: boolean; openedExits: string[]; player: Player; boss: Boss; pots: Pot[]; props: PropState[]; colleagues: Colleague[]; rules: ActiveRule[]; lights: Record<number,boolean>; switchCooldown: Record<number,number>; deskHeights: Record<string,number>; transparentWalls: string[]; pressureRooms: number[]; pressureHeights: Record<number,number>; flowRooms: number[]; interaction: Interaction | null; message: string; messageUntil: number; bubble: string; bubbleUntil: number; nextBubbleAt: number; history: string[]; catches: number; roomId: number; dark: boolean; aiming: boolean; aimTarget: string; dragPath: Vec2[]; dragProgress: number; eventLog: {time:number;event:string}[] }
export interface InputFrame { moveX: number; moveZ: number; yaw: number; sprint: boolean; crouchPressed: boolean; jumpPressed: boolean; interact: boolean; interactPressed: boolean; potPressed: boolean; dropPressed: boolean; throwPressed: boolean; aim: boolean }
export interface WorldQuery { roomAt(p: Vec2): Room | undefined; move(p: Vec2, delta: Vec2, radius: number, height: number, state: GameState, feet?:number): Vec2; lineOfSight(a: Vec2, b: Vec2, height: number, state: GameState, mode?:'vision'|'solid'): boolean; path(a: Vec2,b: Vec2,state: GameState): Vec2[]; validPlacement(p: Vec2,radius: number,state: GameState): boolean; clearance(p:Vec2,state:GameState):number; supportHeight(p:Vec2,state:GameState):number }
export interface Settings { quality: 'high' | 'medium' | 'low'; sensitivity: number; invertY: boolean; reducedMotion: boolean; textScale: number }
export interface UIModel { page: Page; seed: number; version: string; tutorialPage: number; settings: Settings; loadingStage: string; error: string; remaining: number; clock: string; clocked: boolean; objective: string; room: string; dark: boolean; pose: Pose; sticky: boolean; stamina: number; pot: boolean; holding: string; protection: number; bossStatus: string; bossEvidenceRemaining: number; warning: {quote:string;effect:string;remaining:number} | null; rules: {quote:string;effect:string;remaining:number}[]; interaction: {label:string;progress:number} | null; message: string; bubble: string; aiming: boolean; aimTarget: string; phone: boolean; history: string[]; ending: Ending | null; elapsed: number; catches: number; preview?: boolean }
export type UICommand = {type:'start'|'begin'|'home'|'tutorial'|'settings'|'resume'|'restart'|'new-seed'|'retry'|'close-phone'} | {type:'tutorial-page';page:number} | {type:'setting';key:keyof Settings;value:string|number|boolean};
export const DIMENSIONS = { playerRadius:.3, standing:1.75, crouching:.9, rolling:1.42, wallHeight:2.8, doorWidth:2.2, deskHeight:.75 } as const;
