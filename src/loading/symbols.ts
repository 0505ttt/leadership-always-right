import type { FieldSymbol } from './types';

/** Original game pictograms, composed here in a 24 × 24 coordinate space. */
export const GAME_SYMBOLS: readonly FieldSymbol[] = [
  {
    id: 'pot', title: '责任归位', slogan: '责任有形状。\n别被它拖住。', seed: 3, scale: .82,
    background: '#fafaf8', ink: '#111212', detection: '#2152e7', light: true,
    path: 'M4 8H20V15C20 19 17 21 12 21S4 19 4 15Z M4 10H1V14H4Z M20 10H23V14H20Z M3 6H21V8H3Z M9 3H15V6H9Z',
  },
  {
    id: 'chair', title: '工位校准', slogan: '工位会移动。\n路线由你决定。', seed: 29, scale: .79,
    background: '#fafaf8', ink: '#111212', detection: '#2152e7', light: true,
    path: 'M6 1H18V11H6Z M5 12H19V15H5Z M2 9H5V14H2Z M19 9H22V14H19Z M11 15H13V19H11Z M11 18H13V20H11Z M4 21L11 18L12 20L5 23Z M20 21L13 18L12 20L19 23Z M11 19H13V23H11Z',
  },
  {
    id: 'clock', title: '离岗时刻', slogan: '十八点到了。\n自己找路下班。', seed: 51, scale: .81,
    background: '#fafaf8', ink: '#111212', detection: '#2152e7', light: true,
    path: 'M1 6H3V18H1Z M5 6H10V8H5Z M5 11H10V13H5Z M5 16H10V18H5Z M5 7H7V12H5Z M8 7H10V12H8Z M5 12H7V17H5Z M8 12H10V17H8Z M11 9H13V11H11Z M11 14H13V16H11Z M14 6H18V8H14Z M14 16H18V18H14Z M14 8H15.5V16H14Z M16.5 8H18V16H16.5Z M20 6H24V8H20Z M20 16H24V18H20Z M20 8H21.5V16H20Z M22.5 8H24V16H22.5Z',
  },
];
