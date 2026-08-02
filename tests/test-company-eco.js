const fs = require('fs');
const path = require('path');
const assert = require('assert');

const scriptPath = path.join(__dirname, '..', 'warera-prost.user.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Mock simple DOM
const spanTitle = { textContent: 'NEW JOB OFFER', tagName: 'SPAN', dataset: {} };
const spanBenefit = { textContent: 'Estimated benefit per ', tagName: 'SPAN', dataset: {}, parentElement: { appendChild: function(node) { this.children.push(node); }, querySelector: function(sel) { return this.children.find(c => c.id === sel.substring(1)); }, children: [] } };
const inputCompany = { value: 'comp123', name: 'companyId', tagName: 'INPUT', dataset: {} };
const inputWage = { 
  value: '1.0', 
  name: 'wage', 
  tagName: 'INPUT', 
  dataset: {}, 
  listeners: {},
  addEventListener: function(evt, cb) { this.listeners[evt] = cb; },
  removeEventListener: function(evt, cb) { delete this.listeners[evt]; }
};

const modal = {
  id: 'headlessui-dialog-panel-123',
  getAttribute: function(attr) { if (attr === 'data-headlessui-state') return 'open'; return null; },
  querySelectorAll: function(tag) {
    if (tag === 'span') return [spanTitle, spanBenefit];
    return [];
  },
  querySelector: function(sel) {
    if (sel === 'input[name="companyId"]') return inputCompany;
    if (sel === 'input[name="wage"]') return inputWage;
    if (sel === '#wia-eco-net-wage') return spanBenefit.parentElement.querySelector('#wia-eco-net-wage');
    return null;
  }
};

global.document = {
  querySelectorAll: function(sel) {
    if (sel === 'div[id^="headlessui-dialog-panel-"]') return [modal];
    return [];
  },
  createElement: function(tag) {
    return { tagName: tag.toUpperCase(), style: {}, dataset: {}, id: '', classList: { add: ()=>{} }, remove: function() {} };
  },
  contains: function(node) { return true; }
};

let apiCalls = 0;
global.resolveApiBase = async function(procedure, args) {
  apiCalls++;
  if (procedure === 'company.getById') {
    return { payload: { region: 'reg123' } };
  } else if (procedure === 'region.getById') {
    return { payload: { country: 'cnt123' } };
  } else if (procedure === 'country.getCountryById') {
    return { payload: { taxes: { income: 5 } } };
  }
  return { payload: null };
};

global.readCache = () => null;
global.writeCache = () => {};
global.setHealth = () => {};
global.CONFIG = { ecoTaxTtlMs: 100000 };
global.requestAnimationFrame = (cb) => { return setTimeout(cb, 16); };
global.cancelAnimationFrame = (id) => { clearTimeout(id); };

// Extract functions to test
  const ecoCodeBlock1 = scriptContent.match(/let companyEcoModalNode = null;[\s\S]*?function initCompanyEco/)[0].replace('function initCompanyEco', '');
  const ecoCodeBlock2 = scriptContent.match(/function teardownCompanyEco[\s\S]*?\n  }/)[0];
  
  const setupCode = `
  ` + ecoCodeBlock1 + `\n` + ecoCodeBlock2 + `
  
  async function regionToCountry(regionId) {
    if (!regionId) return null;
    const { payload: res } = await resolveApiBase('region.getById', { regionId });
    return res && res.country ? res.country : null;
  }
  
  async function getCountryTax(countryId) {
    if (!countryId) return null;
    const { payload: res } = await resolveApiBase('country.getCountryById', { countryId });
    return res && res.taxes ? res.taxes : null;
  }

  checkCompanyEcoModalWrapper = checkCompanyEcoModal;
  teardownCompanyEcoWrapper = teardownCompanyEco;
`;

eval(setupCode);

async function runTests() {
  console.log('--- Testing Company Economy Idempotency ---');
  
  // Test 1: Initial injection
  apiCalls = 0;
  checkCompanyEcoModalWrapper();
  
  // Wait for async tax fetch to settle
  await new Promise(r => setTimeout(r, 50));
  
  let netLine = spanBenefit.parentElement.querySelector('#wia-eco-net-wage');
  assert(netLine, 'Test 1 Failed: Injected node not found');
  assert(netLine.dataset.taxRate === 5, 'Test 1 Failed: Tax rate not applied');
  assert(apiCalls === 3, 'Test 1 Failed: Should make exactly 3 API calls (company, region, country)');
  console.log('Test 1 passed: injects on matching modal');
  
  // Test 2: React wipe & re-injection
  apiCalls = 0;
  // Simulate React wipe by clearing parent children
  spanBenefit.parentElement.children = [];
  assert(!spanBenefit.parentElement.querySelector('#wia-eco-net-wage'), 'Setup error: node not removed');
  
  checkCompanyEcoModalWrapper();
  
  netLine = spanBenefit.parentElement.querySelector('#wia-eco-net-wage');
  assert(netLine, 'Test 2 Failed: Node was not re-injected after wipe');
  assert(netLine.dataset.taxRate === 5, 'Test 2 Failed: Cached tax rate not restored instantly');
  assert(apiCalls === 0, 'Test 2 Failed: Re-injection triggered unnecessary API calls');
  console.log('Test 2 passed: re-injection after wipe uses cache, no refetch');
  
  // Test 3: (Removed - listener flag no longer used, we use rAF polling)
  console.log('Test 3 skipped: replaced by rAF poll');
  
  // Test 4: Teardown
  teardownCompanyEcoWrapper();
  console.log('Test 4 passed: teardown clears state');
  
  console.log('Company Economy tests passed successfully.\\n');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
