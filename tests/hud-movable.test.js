const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing Movable HUD Elements (makeMovable) ---');

const scriptPath = path.join(__dirname, '../warera-prost.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');

// Mock Tampermonkey / Browser environment
global.GM_addStyle = () => {};
const mockStorage = {};
global.GM_setValue = (key, val) => {
  if (val != null && (typeof val === 'object' || Array.isArray(val))) {
    mockStorage[key] = JSON.stringify(val);
  } else {
    mockStorage[key] = val;
  }
};
global.GM_getValue = (key, def) => {
  const val = key in mockStorage ? mockStorage[key] : def;
  if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
    try { return JSON.parse(val); } catch (e) {}
  }
  return val;
};
global.GM_registerMenuCommand = () => {};
global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

// Mock Element class
class MockElement {
  constructor(tag, classes = '') {
    this.tagName = (tag || 'div').toUpperCase();
    this._className = classes;
    this.style = {};
    this.classList = {
      classes: new Set(classes.split(' ').filter(Boolean)),
      add: (c) => {
        this.classList.classes.add(c);
        this._className = Array.from(this.classList.classes).join(' ');
      },
      remove: (c) => {
        this.classList.classes.delete(c);
        this._className = Array.from(this.classList.classes).join(' ');
      },
      contains: (c) => this.classList.classes.has(c)
    };
    this.children = [];
    this.dataset = {};
    this.parentElement = null;
    this.attributes = new Map();
    this.offsetWidth = 40;
    this.offsetHeight = 40;
    this.listeners = {};
  }

  addEventListener(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  removeEventListener(event, callback) {
    if (this.listeners[event]) {
      const idx = this.listeners[event].indexOf(callback);
      if (idx !== -1) {
        this.listeners[event].splice(idx, 1);
      }
    }
  }

  setPointerCapture() {}
  releasePointerCapture() {}

  getBoundingClientRect() {
    return {
      left: parseFloat(this.style.left) || 100,
      top: parseFloat(this.style.top) || 100,
      width: this.offsetWidth,
      height: this.offsetHeight,
      right: (parseFloat(this.style.left) || 100) + this.offsetWidth,
      bottom: (parseFloat(this.style.top) || 100) + this.offsetHeight
    };
  }

  appendChild(child) {
    if (child) {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }

  insertBefore(newChild, refChild) {
    if (newChild) {
      newChild.parentElement = this;
      this.children.unshift(newChild);
    }
    return newChild;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  getAttribute(name) {
    if (name === 'class') return this._className;
    return this.attributes.get(name) || '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
    if (name === 'class') {
      this._className = value;
    }
  }

  querySelector(selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this._className.includes(cls)) return this;
      for (const child of this.children) {
        const res = child.querySelector(selector);
        if (res) return res;
      }
    }
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.id === id) return this;
      for (const child of this.children) {
        const res = child.querySelector(selector);
        if (res) return res;
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (el) => {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (el._className.includes(cls)) results.push(el);
      } else if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (el.id === id) results.push(el);
      }
      el.children.forEach(walk);
    };
    walk(this);
    return results;
  }
}

global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1000,
  innerHeight: 800,
  getComputedStyle: (el) => el.style,
  setTimeout: (fn, delay) => setTimeout(fn, delay)
};
global.getComputedStyle = global.window.getComputedStyle;

const documentBody = new MockElement('body');
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => new MockElement(tag),
  body: documentBody,
  querySelectorAll: (selector) => documentBody.querySelectorAll(selector),
  querySelector: (selector) => documentBody.querySelector(selector),
  getElementById: (id) => {
    return documentBody.querySelector('#' + id);
  }
};
global.history = { pushState: () => {}, replaceState: () => {} };
global.location = { pathname: '/user/some-id/inventory' };
global.navigator = { userAgent: 'node' };
global.MutationObserver = class { observe() {} disconnect() {} };

// Run the script by eval'ing it
eval(code);

// Assert makeMovable exists
assert.strictEqual(typeof globalThis.makeMovable, 'function', 'makeMovable should be defined on globalThis');

// Let's create a test element and mock slot
const mockElement = new MockElement('div');
mockElement.style.position = 'static';
mockElement.style.left = '';
mockElement.style.top = '';

const mockSlotParent = new MockElement('div');
const slotFn = () => ({ parent: mockSlotParent });

// Instantiate makeMovable
const instance = globalThis.makeMovable(mockElement, {
  id: 'test_item',
  anchorSlot: slotFn,
  anchorDefault: true
});

// Test 1: Initial state is anchored
assert.strictEqual(instance.isAnchored(), true, 'Should be anchored by default');
assert.strictEqual(mockElement.parentElement, mockSlotParent, 'Element should be in the anchorSlot parent');
assert.strictEqual(mockElement.classList.contains('wia-hud-free'), false, 'Should not have wia-hud-free class');

// Test 2: Simulating dragging far away (should become free, unsnap)
const onPointerDown = mockElement.listeners['pointerdown'][0];
const onPointerMove = mockElement.listeners['pointermove'][0];
const onPointerUp = mockElement.listeners['pointerup'][0];

assert.strictEqual(typeof onPointerDown, 'function', 'pointerdown listener should be attached');
assert.strictEqual(typeof onPointerMove, 'function', 'pointermove listener should be attached');
assert.strictEqual(typeof onPointerUp, 'function', 'pointerup listener should be attached');

// Start drag at x=100, y=100 (initial anchored coords)
onPointerDown({
  button: 0,
  pointerId: 1,
  pointerType: 'mouse',
  clientX: 100,
  clientY: 100
});

// Move far away to x=400, y=400 (dx=300, dy=300)
// Distance to anchor (100, 100) is ~424px, way above 30px threshold.
onPointerMove({
  pointerId: 1,
  clientX: 400,
  clientY: 400
});

assert.strictEqual(mockElement.style.left, '400px', 'Left should follow drag');
assert.strictEqual(mockElement.style.top, '400px', 'Top should follow drag');
assert.strictEqual(mockElement.parentElement, documentBody, 'Element should be appended to body while dragging');

onPointerUp({
  pointerId: 1
});

// Element should now be saved as free (not anchored)
assert.strictEqual(instance.isAnchored(), false, 'Should not be anchored when dropped far away');
assert.strictEqual(mockElement.parentElement, documentBody, 'Should stay in documentBody');
assert.strictEqual(mockElement.classList.contains('wia-hud-free'), true, 'Should have wia-hud-free class');

// Verify saved position in mock storage
const savedPos = globalThis.readCache('wia.hud_test_item_pos');
assert.strictEqual(savedPos.x, 400, 'Saved position X should be 400');
assert.strictEqual(savedPos.y, 400, 'Saved position Y should be 400');

// Test 3: Simulating dragging back close to anchor (should snap and re-anchor)
// Start drag from current position (400, 400)
onPointerDown({
  button: 0,
  pointerId: 1,
  pointerType: 'mouse',
  clientX: 400,
  clientY: 400
});

// Move close to anchor: x=110, y=110 (dx=-290, dy=-290, target position 110, 110)
// Distance to anchor (100, 100) is sqrt(10^2 + 10^2) = 14.14px < 30px snapping threshold.
onPointerMove({
  pointerId: 1,
  clientX: 110,
  clientY: 110
});

// Position should snap exactly to anchor (100, 100)
assert.strictEqual(mockElement.style.left, '100px', 'Left should snap to 100px');
assert.strictEqual(mockElement.style.top, '100px', 'Top should snap to 100px');

// Drop it while snapped
onPointerUp({
  pointerId: 1
});

// Element should snap back to slot parent and become anchored
assert.strictEqual(instance.isAnchored(), true, 'Should snap back to anchored');
assert.strictEqual(mockElement.parentElement, mockSlotParent, 'Should return to mockSlotParent');
assert.strictEqual(mockElement.classList.contains('wia-hud-free'), false, 'Should lose wia-hud-free class');
assert.strictEqual(mockElement.style.position, 'static', 'Should restore original static position style');

// Verify saved position is cleared and anchored is set
assert.strictEqual(globalThis.readCache('wia.hud_test_item_pos'), null, 'Saved position should be cleared');
assert.strictEqual(globalThis.readCache('wia.hud_test_item_anchored'), true, 'Should be persisted as anchored');

// Test 4: Destroy removes event listeners
instance.destroy();
// Test complete
console.log('Success! makeMovable tests passed successfully.');
process.exit(0);
