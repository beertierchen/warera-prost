import re

with open('warera-prost.user.js', 'r') as f:
    content = f.read()

# 1. Add to CONFIG
content = content.replace(
    "    featEquipSellCalc: false,\n    featEquipSellCalcIntroducedIn: '0.12.0',",
    "    featEquipSellCalc: false,\n    featEquipSellCalcIntroducedIn: '0.12.0',\n    equipSellCalcUndercut: true,"
)

# 2. Add to KEYS
content = content.replace(
    "    featEquipSellCalc: NS + 'featEquipSellCalc',",
    "    featEquipSellCalc: NS + 'featEquipSellCalc',\n    equipSellCalcUndercut: NS + 'equipSellCalcUndercut',"
)

# 3. Add to load() function near the bottom where CONFIG is loaded
content = content.replace(
    "    CONFIG.featEquipSellCalc = GM_getValue(KEYS.featEquipSellCalc, false);",
    "    CONFIG.featEquipSellCalc = GM_getValue(KEYS.featEquipSellCalc, false);\n    CONFIG.equipSellCalcUndercut = GM_getValue(KEYS.equipSellCalcUndercut, true);"
)

# 4. Add i18n keys
# Find equipSellCalcTargetLabel
content = content.replace(
    "equipSellCalcTargetLabel: 'Ziel (Netto) nach Steuern',",
    "equipSellCalcTargetLabel: 'Ziel (Netto) nach Steuern',\n    equipSellCalcUndercutLabel: 'Unterbieten (-0.001)',"
)
content = content.replace(
    "equipSellCalcTargetLabel: 'Target (Net) after taxes',",
    "equipSellCalcTargetLabel: 'Target (Net) after taxes',\n    equipSellCalcUndercutLabel: 'Undercut (-0.001)',"
)

# 5. UI injection in showEquipSellCalcPanel
ui_original = """      <div style="display: flex; gap: 8px; margin-bottom: 12px;">
        <div style="flex: 2;">
          <label style="font-size: 11px; color: #8b949e; display: block; margin-bottom: 2px;">${t('equipSellCalcTargetLabel')}</label>
          <input type="number" step="0.001" class="wia-calc-target" style="width: 100%; box-sizing: border-box; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; padding: 4px 8px; font-size: 12px;" />
        </div>
        <div style="flex: 1;">
          <label style="font-size: 11px; color: #8b949e; display: block; margin-bottom: 2px;">${t('equipSellCalcTaxLabel')} (%)</label>
          <input type="number" step="0.1" class="wia-calc-tax" style="width: 100%; box-sizing: border-box; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; padding: 4px 8px; font-size: 12px;" />
        </div>
      </div>"""

ui_new = """      <div style="display: flex; gap: 8px; margin-bottom: 6px;">
        <div style="flex: 2;">
          <label style="font-size: 11px; color: #8b949e; display: block; margin-bottom: 2px;">${t('equipSellCalcTargetLabel')}</label>
          <input type="number" step="0.001" class="wia-calc-target" style="width: 100%; box-sizing: border-box; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; padding: 4px 8px; font-size: 12px;" />
        </div>
        <div style="flex: 1;">
          <label style="font-size: 11px; color: #8b949e; display: block; margin-bottom: 2px;">${t('equipSellCalcTaxLabel')} (%)</label>
          <input type="number" step="0.1" class="wia-calc-tax" style="width: 100%; box-sizing: border-box; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; padding: 4px 8px; font-size: 12px;" />
        </div>
      </div>
      <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
        <input type="checkbox" class="wia-calc-undercut" style="width: auto; margin: 0;" ${CONFIG.equipSellCalcUndercut ? 'checked' : ''} />
        <label style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none;">${t('equipSellCalcUndercutLabel')}</label>
      </div>"""

content = content.replace(ui_original, ui_new)

# 6. Listeners and math logic
# In showEquipSellCalcPanel, we need to bind the undercut checkbox and modify the update() call.
logic_original = """    const taxInput = panel.querySelector('.wia-calc-tax');
    const resultDiv = panel.querySelector('.wia-calc-result');
    const ticksDiv = panel.querySelector('.wia-calc-ticks');

    // Default tax to last used or 1%
    taxInput.value = GM_getValue(NS + 'lastEquipSellTax', 1.0);

    const update = () => {
      const targetStr = targetInput.value.replace(',', '.');
      const target = parseFloat(targetStr);"""

logic_new = """    const taxInput = panel.querySelector('.wia-calc-tax');
    const undercutCheck = panel.querySelector('.wia-calc-undercut');
    const resultDiv = panel.querySelector('.wia-calc-result');
    const ticksDiv = panel.querySelector('.wia-calc-ticks');

    // Default tax to last used or 1%
    taxInput.value = GM_getValue(NS + 'lastEquipSellTax', 1.0);

    const update = () => {
      const targetStr = targetInput.value.replace(',', '.');
      let target = parseFloat(targetStr);
      
      if (!isNaN(target) && undercutCheck.checked) {
        target = target - 0.001;
      }"""

content = content.replace(logic_original, logic_new)

bind_original = """    targetInput.addEventListener('input', update);
    taxInput.addEventListener('input', () => {
      GM_setValue(NS + 'lastEquipSellTax', parseFloat(taxInput.value) || 1.0);
      update();
    });"""
bind_new = """    targetInput.addEventListener('input', update);
    taxInput.addEventListener('input', () => {
      GM_setValue(NS + 'lastEquipSellTax', parseFloat(taxInput.value) || 1.0);
      update();
    });
    undercutCheck.addEventListener('change', () => {
      CONFIG.equipSellCalcUndercut = undercutCheck.checked;
      GM_setValue(KEYS.equipSellCalcUndercut, undercutCheck.checked);
      update();
    });
    const undercutLabel = panel.querySelector('.wia-calc-undercut').nextElementSibling;
    if (undercutLabel) undercutLabel.addEventListener('click', () => {
      undercutCheck.checked = !undercutCheck.checked;
      undercutCheck.dispatchEvent(new Event('change'));
    });"""

content = content.replace(bind_original, bind_new)

with open('warera-prost.user.js', 'w') as f:
    f.write(content)
print("Applied undercut fixes to warera-prost.user.js")
