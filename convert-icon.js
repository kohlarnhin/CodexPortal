const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');

try {
  const svg = fs.readFileSync('app-icon.svg', 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1024 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  fs.writeFileSync('app-icon.png', pngBuffer);
  console.log('PNG generated: app-icon.png');
} catch (error) {
  console.error('Error generating PNG:', error);
  process.exit(1);
}
