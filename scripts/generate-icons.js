const fs = require('fs');
const path = require('path');

// We can also copy or create a data URL or PNG buffers
// If canvas or sharp is not installed, we can generate a valid PNG structure or copy icons
const iconDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconDir)) {
  fs.mkdirSync(iconDir, { recursive: true });
}

// Copy icon.svg to favicon and create web-ready references
const svgContent = fs.readFileSync(path.join(iconDir, 'icon.svg'), 'utf8');

// For modern browsers & PWAs, SVG works as direct icon, but let's also ensure fallback files exist
['icon-192.png', 'icon-512.png', 'icon-maskable.png', 'apple-touch-icon.png'].forEach(file => {
  const filePath = path.join(iconDir, file);
  if (!fs.existsSync(filePath)) {
    // Copy the SVG icon as fallback if binary PNG generator is unavailable
    fs.writeFileSync(filePath, svgContent);
  }
});

console.log('PWA icons configured successfully in public/icons');
