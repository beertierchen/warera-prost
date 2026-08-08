const assert = require('assert');
const fs = require('fs');

const scriptContent = fs.readFileSync('./warera-prost.user.js', 'utf8');

// Mock Tampermonkey / DOM
const storage = {};
global.GM_getValue = (key, def) => storage[key] !== undefined ? storage[key] : def;
global.GM_setValue = (key, val) => { storage[key] = val; };
global.GM_deleteValue = (key) => { delete storage[key]; };

global.document = {
  createElement: (tag) => {
    const mockNode = {
      className: '',
      style: {},
      innerHTML: '',
      appendChild: () => {},
      addEventListener: () => {},
      textContent: '',
      value: '',
      focus: () => {},
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 300, height: 300 }),
      offsetWidth: 300,
      offsetHeight: 300
    };
    mockNode.querySelector = () => mockNode;
    return mockNode;
  },
  body: {
    appendChild: () => {},
    style: {}
  }
};
global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1024,
  innerHeight: 768
};
global.ResizeObserver = class { observe() {} };
global.setHealth = () => {};

// Extract scratchpad functions
const extractMatches = scriptContent.match(/const KEYS_SCRATCHPAD =.*?function initScratchpad\(\) \{.*?setHealth\('scratchpad', 'ok'\);\s*\}/s);
if (!extractMatches) {
  console.error("Could not find scratchpad logic to test.");
  process.exit(1);
}

// Add some required variables for compilation
let compiled = `
  function escapeHtml() {}
  ${extractMatches[0]}
  
  Object.assign(module, {
    scratchpadLoadIndex,
    scratchpadSaveIndex,
    scratchpadLoadNote,
    scratchpadSaveNote,
    scratchpadDeleteNote,
    createNewNote,
    initScratchpad,
    KEYS_SCRATCHPAD
  });
`;

const mod = {};
try {
  eval(`(function(module) { ${compiled} })(mod)`);
} catch (e) {
  console.error("Failed to evaluate scratchpad test module:", e);
  process.exit(1);
}

console.log("--- Testing Scratchpad Logic ---");
mod.initScratchpad();

// Test 1: CRUD
mod.createNewNote();
const idx1 = mod.scratchpadLoadIndex();
assert.strictEqual(idx1.length, 1, "Index should contain 1 note");
const noteId = idx1[0].id;
assert.strictEqual(mod.scratchpadLoadNote(noteId), "", "New note should be empty");

mod.scratchpadSaveNote(noteId, "Hello World");
assert.strictEqual(mod.scratchpadLoadNote(noteId), "Hello World", "Note should be saved");

// Test 2: Sort order (updatedAt desc)
const initialTime = idx1[0].updatedAt;

// Create second note
mod.createNewNote();
const idx2 = mod.scratchpadLoadIndex();
assert.strictEqual(idx2.length, 2, "Index should contain 2 notes");

const noteId2 = idx2[0].id; // The new one is unshifted
// Wait a little (mocking)
idx2[1].updatedAt = initialTime;
idx2[0].updatedAt = initialTime + 1000;
mod.scratchpadSaveIndex(idx2);

// Now update the FIRST note (idx2[1]) so it becomes the most recently updated
// We need to override Date.now() for a moment
const realDateNow = Date.now;
Date.now = () => initialTime + 5000;
mod.scratchpadSaveNote(noteId, "Updated Hello World");
Date.now = realDateNow;

const idx3 = mod.scratchpadLoadIndex();
assert.strictEqual(idx3[0].id, noteId, "The updated note should bubble to the top (index 0)");
assert.strictEqual(idx3[1].id, noteId2, "The unmodified note should fall to index 1");

// Test 3: Delete
mod.scratchpadDeleteNote(noteId);
const idx4 = mod.scratchpadLoadIndex();
assert.strictEqual(idx4.length, 1, "Index should contain 1 note after deletion");
assert.strictEqual(idx4[0].id, noteId2, "The remaining note should be noteId2");
assert.strictEqual(mod.scratchpadLoadNote(noteId), '', "Deleted note should return default empty string in storage");

console.log("Scratchpad tests passed successfully.");
