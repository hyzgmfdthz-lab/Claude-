#!/bin/bash
set -e
cd "$(dirname "$0")/.."
START=$(grep -n '^var __defs = {};$' original/Armaturenbau-MEGC.html | head -1 | cut -d: -f1)
END=$(grep -n '^__req("web/js/main.js");$' original/Armaturenbau-MEGC.html | head -1 | cut -d: -f1)
END=$((END-1))
sed -n "${START},${END}p" original/Armaturenbau-MEGC.html > scratch/engine-bundle.js
echo "if (typeof module !== 'undefined') { module.exports = { __req, __defs, __cache }; }" >> scratch/engine-bundle.js
echo "Extracted lines $START-$END into scratch/engine-bundle.js"
