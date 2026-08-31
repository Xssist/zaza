// One-off patch: allow https:// image URLs through normalizeAssetPath in app.min.js
// (mirrors the fix applied to js/app.js). Safe to delete after running.
const fs = require('fs');

const file = 'js/app.min.js';
let s = fs.readFileSync(file, 'utf8');

const oldStr = 'if(!(e=e.trim())||/^(?:https?:|data:|blob:|javascript:|file:)/i.test(e))return"";const t=e.match(/assets[/\\\\][^?#]+$/i)';
const newStr = 'if(!(e=e.trim())||/^(?:data:|blob:|javascript:|file:)/i.test(e))return"";'
  + 'if(/^https:\\/\\//i.test(e)){try{const n=new URL(e);return"https:"===n.protocol?n.href:""}catch(e){return""}}'
  + 'if(/^http:\\/\\//i.test(e))return"";'
  + 'const t=e.match(/assets[/\\\\][^?#]+$/i)';

if (s.includes(newStr)) { console.log('already patched'); process.exit(0); }
if (!s.includes(oldStr)) { console.error('PATTERN NOT FOUND'); process.exit(1); }

s = s.replace(oldStr, newStr);
fs.writeFileSync(file, s);
console.log('patched OK');
