import { mountPreview } from './preview';

const host = document.querySelector<HTMLElement>('#ui');
if (!host) throw new Error('Missing departure preview host');
mountPreview(host, () => { /* Fixed visual samples intentionally do not create game state. */ });
