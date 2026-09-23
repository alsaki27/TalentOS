const fs = require('fs');
const path = require('path');

function walk(dir, results) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, results);
    else if (/route\.ts$/.test(f)) results.push(full);
  }
}

const routes = [];
walk('src/app/api', routes);

const bad = [];
for (const f of routes) {
  const content = fs.readFileSync(f, 'utf8');
  if (!content.includes('supabase')) continue;
  const hasConditional = content.includes('isNeon()');
  if (!hasConditional) {
    bad.push(path.relative('src/app/api', f).split(path.sep).join('/'));
  }
}

console.log('Truly unconditional supabase routes (' + bad.length + '):');
for (const r of bad.sort()) console.log('  ' + r);
