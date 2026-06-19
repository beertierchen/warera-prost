const fs = require('fs');
const path = require('path');

console.log('--- Testing WareEra Inventory Advisor script load ---');

const scriptPath = path.join(__dirname, '../warera-inventory-advisor.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');

// Mock Tampermonkey / Browser environment
global.GM_addStyle = () => {};
global.GM_getValue = (key, def) => def;
global.GM_setValue = () => {};
global.GM_registerMenuCommand = () => {};

// Mock Element class
class MockElement {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.style = {};
    this.classList = {
      add: () => {},
      remove: () => {}
    };
    this.children = [];
    this.dataset = {};
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  insertBefore(newChild, refChild) {
    this.children.unshift(newChild);
    return newChild;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  remove() {}
  getAttribute() {
    return '';
  }
  setAttribute() {}
}

// Mock Browser globals
global.window = {
  addEventListener: () => {}
};
global.document = {
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  querySelectorAll: () => [],
  querySelector: () => null
};
global.history = {
  pushState: () => {},
  replaceState: () => {}
};
global.location = {
  pathname: '/user/some-id/inventory'
};
global.navigator = {
  userAgent: 'node'
};
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};

try {
  // Run the script by eval'ing it
  eval(code);
  console.log('Success! The script loaded and initialized without throwing any runtime errors.');
  process.exit(0);
} catch (err) {
  console.error('Error during script load/execution:');
  console.error(err.stack || err);
  process.exit(1);
}
