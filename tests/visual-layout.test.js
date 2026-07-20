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
  if (centerX > 678) return 'right';
  if (centerY > 350) return 'bottom';
  return 'left';
}

test('15-seat rectangular tables grow and distribute seats on one perimeter', () => {
  const seatLayout = loadSeatLayout();
  const guest = { name: 'Place longue', regime: 'sans gluten' };
  const seats = Array.from({ length: 15 }, (_, index) => seatLayout(index, 15, 'rectangle', guest));
  const sides = seats.map(sideOfRectangle);
  const count = side => sides.filter(value => value === side).length;

  assert.deepEqual(
    { top: count('top'), right: count('right'), bottom: count('bottom'), left: count('left') },
    { top: 4, right: 4, bottom: 4, left: 3 },
  );

  for (const side of ['top','right','bottom','left']) {
    const sideSeats=seats.filter(seat=>sideOfRectangle(seat)===side).sort((a,b)=>side==='top'||side==='bottom' ? a.left-b.left : a.top-b.top);
    for(let index=1; index<sideSeats.length; index++){
      const previous=sideSeats[index-1]; const current=sideSeats[index];
      if(side==='top'||side==='bottom') assert.ok(previous.left+previous.width < current.left, `${side} seats should not overlap`);
      else assert.ok(previous.top+previous.height < current.top, `${side} seats should not overlap`);
    }
  }
});
