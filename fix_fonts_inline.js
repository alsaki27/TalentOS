const fs = require('fs');

const dir = 'src/components/falood/resumify/components/preview/templates/';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = dir + file;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Remove the getFontSizeClass function
  content = content.replace(/const getFontSizeClass = \(\) => \{[\s\S]*?\};\n/, "");
  
  // Replace className calls with inline style font-size instead
  content = content.replace(/className=\{`([^`]*)\$\{getFontSizeClass\(\)\}([^`]*)`\}/g, 'className={`$1$2`} style={{ fontSize: fontSize === "small" ? "0.8em" : fontSize === "large" ? "1.2em" : "1em" }}');
  
  // Wait, there are cases where it's used inside string literals
  // It's safer to just change what getFontSizeClass returns, but wait, the easiest is to just use standard tailwind classes?
  // No, standard tailwind classes use `rem`.
  // Let's just redefine getFontSizeClass to return a string, but use an inline style in the root div.
}
