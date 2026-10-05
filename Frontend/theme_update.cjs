const fs = require('fs');
const path = 'c:/Users/MAYAN/Appzeto Projects/k9rides/frontend/src/modules/Food/pages/user/Dining.jsx';
let content = fs.readFileSync(path, 'utf8');

// Primary colors
content = content.replace(/#711313/g, '#ec4899'); // pink-500
content = content.replace(/#5b0f0f/g, '#db2777'); // pink-600
content = content.replace(/#ffb800/g, '#f97316'); // orange-500
content = content.replace(/bg-\[\#711313\]/g, 'bg-gradient-to-r from-pink-500 to-orange-500');

// Gradients - replace the old radial/linear gradients with pink/orange themed ones
content = content.replace(/rgba\(235,89,14,0\.24\)/g, 'rgba(236,72,153,0.15)'); // pink-500 light
content = content.replace(/rgba\(235,89,14,0\.2\)/g, 'rgba(236,72,153,0.1)'); // pink-500 lighter
content = content.replace(/rgba\(235,89,14,0\.15\)/g, 'rgba(236,72,153,0.08)'); // pink-500 even lighter

// Pale backgrounds
content = content.replace(/#fff9f2/g, '#fff1f2'); // rose-50
content = content.replace(/#fff2e6/g, '#ffe4e6'); // rose-100
content = content.replace(/#fff4e8/g, '#fff1f2'); 
content = content.replace(/#ffe9d5/g, '#ffe4e6');
content = content.replace(/#fff0e0/g, '#fff1f2');
content = content.replace(/#ffe5ca/g, '#ffe4e6');
content = content.replace(/#fff1e1/g, '#fff1f2');
content = content.replace(/#ffe5d0/g, '#ffe4e6');

// Light borders/badges
content = content.replace(/#e9e1d8/g, '#fecdd3'); // rose-200
content = content.replace(/#efe2d3/g, '#fecdd3');
content = content.replace(/#ead2bc/g, '#fda4af'); // rose-300
content = content.replace(/#f3e3d4/g, '#fecdd3');
content = content.replace(/#f0dcca/g, '#fecdd3');
content = content.replace(/#ead8c8/g, '#fecdd3');
content = content.replace(/#f2e7dd/g, '#ffe4e6');

// Text colors that used browns
content = content.replace(/#8d5324/g, '#e11d48'); // rose-600
content = content.replace(/#b46f37/g, '#be123c'); // rose-700
content = content.replace(/#6d5744/g, '#9f1239'); // rose-800
content = content.replace(/#2e1d11/g, '#4c0519'); // rose-950

// Specific replacements to ensure vibrant gradients where possible
content = content.replace(/bg-gradient-to-r from-\[\#711313\]/g, 'bg-gradient-to-r from-pink-500');
content = content.replace(/bg-gradient-to-br from-\[\#711313\]/g, 'bg-gradient-to-br from-pink-500');
content = content.replace(/to-\[\#ffb800\]/g, 'to-orange-500');

fs.writeFileSync(path, content, 'utf8');
console.log('Theme updated successfully.');

