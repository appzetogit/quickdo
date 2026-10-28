const fs = require('fs');
const path = 'c:/Users/MAYAN/Appzeto Projects/k9rides/frontend/src/modules/Food/pages/user/Dining.jsx';
let content = fs.readFileSync(path, 'utf8');

// Replace standard tailwind pink/rose colors to orange/amber
content = content.replace(/pink-500/g, '[#d82c23]'); // Red/Orange primary
content = content.replace(/pink-600/g, 'red-700'); 
content = content.replace(/orange-500/g, '[#ff6d00]');
content = content.replace(/rose-/g, 'orange-'); 

// Replace specific hex codes that were used previously
content = content.replace(/#ec4899/g, '#d82c23');
content = content.replace(/#db2777/g, '#b91c1c');
content = content.replace(/#f97316/g, '#ff6d00');

// Fix rgba for gradients
content = content.replace(/rgba\(236,72,153,0\.15\)/g, 'rgba(216,44,35,0.15)');
content = content.replace(/rgba\(236,72,153,0\.1\)/g, 'rgba(216,44,35,0.1)');
content = content.replace(/rgba\(236,72,153,0\.08\)/g, 'rgba(216,44,35,0.08)');

fs.writeFileSync(path, content, 'utf8');
console.log('Theme updated successfully.');
