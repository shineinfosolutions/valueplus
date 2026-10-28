const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.next') && !file.includes('.git')) {
        results = results.concat(walk(file));
      }
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('./app').concat(walk('./components'));
let changedFiles = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  
  const regex = /<Input[^>]*type=[\"']number[\"'][^>]*>/g;
  
  content = content.replace(regex, (match) => {
    if (!match.includes('onKeyDown')) {
      changed = true;
      let newMatch = match.replace('type=\"number\"', 'type=\"number\" onKeyDown={(e) => [\"-\", \"+\", \"e\", \"E\"].includes(e.key) && e.preventDefault()}');
      if (!newMatch.includes('min=')) {
        newMatch = newMatch.replace('type=\"number\"', 'type=\"number\" min=\"0\"');
      }
      return newMatch;
    }
    return match;
  });

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    changedFiles++;
    console.log('Updated:', file);
  }
});

console.log('Total files updated:', changedFiles);
