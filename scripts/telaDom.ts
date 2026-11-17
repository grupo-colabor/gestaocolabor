/**
 * Ambiente de DOM (happy-dom) para os smokes que montam componente de
 * verdade. Importe ANTES de React DOM: o esbuild avalia os imports na ordem,
 * então este módulo roda primeiro.
 */
import { Window } from 'happy-dom';

export const win = new Window({ url: 'http://localhost/' });
const g = globalThis as any;
g.window = win;
g.document = win.document;
g.navigator = win.navigator;
for (const k of [
  'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLIFrameElement', 'Element', 'Node', 'Text',
  'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent', 'MutationObserver',
]) {
  if ((win as any)[k]) g[k] = (win as any)[k];
}
g.localStorage = win.localStorage;
g.getComputedStyle = win.getComputedStyle.bind(win);
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
g.IS_REACT_ACT_ENVIRONMENT = true;
