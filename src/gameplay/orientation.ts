/** Touch gameplay is landscape-only; menus may remain responsive in portrait. */
export function requiresLandscapeForTouch(touchMode: boolean, width: number, height: number): boolean {
  return touchMode && height > width;
}
