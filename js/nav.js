// Navigation contract shared by all screens. app.js fills in the implementation.
import { View } from './ui.js';

export const nav = {
  push(screen) {}, pop() {}, popToRoot() {}, switchTab(name) {}, refresh() {},
  currentTab: 'calendar',
  topScreen() { return null; },
};

export class Screen extends View {
  constructor(title = '') {
    super();
    this.title = title;
    this.actions.__back = () => nav.pop();
  }
  /** Extra buttons on the right of the navigation bar (HTML). */
  navRight() { return ''; }
  /** Hide the navigation bar and render a custom header instead. */
  get hideNav() { return false; }
}
