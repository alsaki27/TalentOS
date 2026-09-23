const fs = require('fs');

const dir = 'src/components/falood/resumify/components/preview/templates/';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = dir + file;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Remove the previous getFontSizeClass entirely
  content = content.replace(/const getFontSizeClass = \(\) => \{[\s\S]*?^\s*\};\n/m, `const getFontSizePx = () => {
    switch (fontSize) {
      case 'small': return '4.5px';
      case 'large': return '6.5px';
      default: return '5.5px';
    }
  };\n`);
  
  // Replace the usage of ${getFontSizeClass()} in className with nothing (or keep it clean)
  // Wait, there are many occurrences like className={`${getFontSizeClass()} ...`}
  // We can just define getFontSizeClass to return an empty string to keep className clean,
  // AND add style={{ fontSize: getFontSizePx() }} to the outermost div of the template!
  // Wait, if we add it to the outermost div, it will cascade down, UNLESS inner elements have their own text-sm classes.
  // Did inner elements have text-xs classes?
  
  // Actually, wait! The regex I used earlier replaced ALL occurrences of getFontSizeClass? No, it only replaced the function definition.
  // The templates have className={`... ${getFontSizeClass()}`} on MULTIPLE elements! (like h4, p, li)
  // Let's check how getFontSizeClass is used in TechSidebarTemplate.tsx
}
