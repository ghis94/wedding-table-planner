const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadSeatLayout() {
  const source = fs.readFileSync('visual.html', 'utf8');
  const geometryStart = source.indexOf('    const TABLE_DIMENSIONS=');
  const geometryEnd = source.indexOf('    function renderPlanSelect');
  const layoutStart = source.indexOf('    function estimateChipSize');
  const layoutEnd = source.indexOf('    function clusterBounds');

  assert.ok(geometryStart >= 0 && geometryEnd > geometryStart, 'table geometry helpers should exist');
  assert.ok(layoutStart >= 0 && layoutEnd > layoutStart, 'seat layout helpers should exist');

  return new Function(`${source.slice(geometryStart, geometryEnd)}\n${source.slice(layoutStart, layoutEnd)}\nreturn seatLayout;`)();
}

function sideOfRectangle(seat) {
  const centerX = seat.left + seat.width / 2;
  const centerY = seat.top + seat.height / 2;
  if (centerY < 150) return 'top';
  if (centerX > 410) return 'right';
  if (centerY > 300) return 'bottom';
  return 'left';
}

test('rectangular tables distribute seats around all four sides', () => {
  const seatLayout = loadSeatLayout();
  const guest = { name: 'Place longue', regime: 'sans gluten' };
  const sides = Array.from({ length: 10 }, (_, index) => sideOfRectangle(seatLayout(index, 10, 'rectangle', guest)));
  const count = side => sides.filter(value => value === side).length;

  assert.deepEqual(
    { top: count('top'), right: count('right'), bottom: count('bottom'), left: count('left') },
    { top: 2, right: 3, bottom: 2, left: 3 },
  );
});
