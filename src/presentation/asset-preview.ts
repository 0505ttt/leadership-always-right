import { mountAssetGallery } from './asset-gallery';

// Visual-only entry: do not boot the game, rules, input or a second WebGL scene.
const gallery = mountAssetGallery(document.querySelector<HTMLElement>('#ui')!);
window.addEventListener('pagehide', () => gallery.destroy(), { once: true });
