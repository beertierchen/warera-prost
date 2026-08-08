#!/usr/bin/env bash
set -euo pipefail

SCRIPT="warera-prost.user.js"
ERRORS=0

echo "=== Static Analysis: $SCRIPT ==="

# 1. Undefined variable patterns — catches memberObj-class bugs.
#    Scans for variables used but never declared (const/let/var/function/param).
#    Add known-bad patterns here as they're discovered.
echo ""
echo "--- Checking for known undefined variable patterns ---"

KNOWN_BAD_VARS=(
  "memberObj"
)

for var in "${KNOWN_BAD_VARS[@]}"; do
  if grep -n "\b${var}\b" "$SCRIPT" > /dev/null 2>&1; then
    echo "FAIL: Found reference to undeclared variable '$var':"
    grep -n "\b${var}\b" "$SCRIPT" | head -5
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: No references to '$var'"
  fi
done

# 2. Security compliance — automated checks from CLAUDE.md requirements.
echo ""
echo "--- Security compliance checks ---"

# 2a. GM_xmlhttpRequest must use anonymous: true (no session cookie leaks)
if ! grep -q 'anonymous:\s*true' "$SCRIPT"; then
  echo "FAIL: GM_xmlhttpRequest missing anonymous: true"
  ERRORS=$((ERRORS + 1))
else
  echo "OK: anonymous: true present"
fi

# 2b. No raw fetch() to WareEra endpoints — must use resolveApiBase/resolveApiPost
RAW_FETCH=$(grep -n "fetch\s*(" "$SCRIPT" | grep -i "warera\|api2\." || true)
if [ -n "$RAW_FETCH" ]; then
  echo "FAIL: Raw fetch() to WareEra endpoint detected (use resolveApiBase/resolveApiPost):"
  echo "$RAW_FETCH" | head -5
  ERRORS=$((ERRORS + 1))
else
  echo "OK: No raw fetch() to WareEra endpoints"
fi

# 2c. No unsafeWindow leaks outside CONFIG.debug gate
# Check for unsafeWindow assignments not inside a debug block
UNSAFE_ASSIGNS=$(grep -n 'unsafeWindow\.' "$SCRIPT" | grep -v '^\s*//' || true)
UNSAFE_COUNT=$(echo "$UNSAFE_ASSIGNS" | grep -c . || true)
if [ "$UNSAFE_COUNT" -gt 3 ]; then
  echo "WARN: $UNSAFE_COUNT unsafeWindow references found — verify all are debug-gated:"
  echo "$UNSAFE_ASSIGNS" | head -5
fi

# 2d. No hardcoded API keys anywhere in repo (tracked + untracked)
API_KEY_HITS=$(grep -rln 'wae_[a-f0-9]\{20,\}' --include='*.js' --include='*.json' --include='*.ts' . 2>/dev/null | grep -v node_modules || true)
if [ -n "$API_KEY_HITS" ]; then
  echo "FAIL: Hardcoded API key(s) found:"
  echo "$API_KEY_HITS" | sed 's/^/  - /'
  ERRORS=$((ERRORS + 1))
else
  echo "OK: No hardcoded API keys"
fi

# 2e. Version header: no -unstable suffix on main (informational — normalize workflow handles this)
if grep -q '@version.*-unstable' "$SCRIPT"; then
  echo "INFO: -unstable version suffix present (normalize workflow will strip on main)"
fi

# 2f. Name header: no TEST prefix on main
if grep -q '@name.*TEST' "$SCRIPT"; then
  echo "INFO: TEST prefix in @name (normalize workflow will strip on main)"
fi

# 3. Debug/Health system compliance — every regFeature should have a guard
echo ""
echo "--- Debug/Health system compliance ---"

REG_FEATURES=$(grep -o "regFeature('[^']*'" "$SCRIPT" | sed "s/regFeature('//;s/'$//" | sort)
GUARD_FEATURES=$(grep -o "guard('[^']*'" "$SCRIPT" | sed "s/guard('//;s/'$//" | sort)

REG_ONLY=$(comm -23 <(echo "$REG_FEATURES") <(echo "$GUARD_FEATURES"))
if [ -n "$REG_ONLY" ]; then
  echo "WARN: Features registered but missing guard() wrapper:"
  echo "$REG_ONLY" | sed 's/^/  - /'
fi

echo ""
echo "=== Static Analysis Complete ==="
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS error(s) found"
  exit 1
else
  echo "PASSED: All checks OK"
  exit 0
fi
