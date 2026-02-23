// Generates a simple SVG icon and saves it for electron-builder
const fs   = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#0d0e11"/>
      <stop offset="100%" stop-color="#1a1b2e"/>
    </linearGradient>
    <linearGradient id="acc" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#7c6ff7"/>
      <stop offset="100%" stop-color="#a89ef9"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
  <text x="512" y="660" text-anchor="middle" font-family="serif" font-size="580" fill="url(#acc)">✦</text>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'icon.svg'), svg);
console.log('✓ assets/icon.svg written');
console.log('  To convert to icon.icns, run:');
console.log('  npx @electron-tools/icon-maker assets/icon.svg --out assets/');
console.log('  OR install Xcode and use iconutil');
