import { mountFieldStudy } from './screen';
import { REFERENCE_SYMBOLS } from './reference-symbols';

const study = mountFieldStudy(document.body, REFERENCE_SYMBOLS, 'Identity, in lines.', 'Move through a familiar mark. Find the structure beneath the surface.');
study.root.querySelector('.office-loader__company')!.textContent = 'StyleKit / Visual studies';
study.root.querySelectorAll('.office-loader__source').forEach(button => { button.textContent = 'Reveal the source →'; });
const footer = document.createElement('footer'); footer.className = 'office-loader__note';
footer.textContent = 'A study of recognition and reconstruction.';
const end = document.createElement('span'); end.textContent = 'One path. A field of light. Four line weights.'; footer.append(end); study.inner.append(footer);
Object.defineProperty(window, '__LINE_FIELD_REFERENCE__', { value: { getDiagnostics: () => study.getDiagnostics() }, configurable: false });
