import type { TouchAction } from './touch-state';

/** Two always-visible actions plus one menu button; all seven others remain one tap away. */
export const touchActionGroups = {
  primary: ['interact', 'sprint'],
  secondary: ['jump', 'crouch', 'pot', 'aim', 'throw', 'drop', 'computer'],
} as const satisfies { primary: readonly TouchAction[]; secondary: readonly TouchAction[] };
