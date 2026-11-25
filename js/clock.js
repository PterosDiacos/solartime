// SVG solar dial.
// Angles are measured in degrees clockwise from the bottom of the dial:
//   0   = bottom (sunrise)     90  = left (solar noon)
//   180 = top (sunset)         270 = right (solar midnight)
// Day hours fill the left half bottom -> top, night hours the right half top -> bottom.

const NS = 'http://www.w3.org/2000/svg';
const C = 200;
const R_OUT = 170;        // outer edge of the hour band
const R_IN = 122;         // inner edge of the hour band
const R_NUM = 102;        // hour numerals
const R_TIME = 186;       // time labels outside the band
const MAJOR = new Set([3, 6, 9, 12]);
const CAPTIONS = {
  day: { 6: 'noon', 12: 'sunset' },
  night: { 6: 'midnight', 12: 'sunrise' },
};

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function pt(theta, r) {
  const a = theta * Math.PI / 180;
  return [C - r * Math.sin(a), C + r * Math.cos(a)];
}

function sector(t0, t1, r0, r1) {
  const [x0, y0] = pt(t0, r1), [x1, y1] = pt(t1, r1);
  const [x2, y2] = pt(t1, r0), [x3, y3] = pt(t0, r0);
  const large = t1 - t0 > 180 ? 1 : 0;
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

const thetaOf = (phase, i) => (phase === 'day' ? 0 : 180) + 15 * i;

function gradient(defs, id, stops) {
  const g = el('linearGradient', { id, x1: 0, y1: 1, x2: 0, y2: 0 }, defs);
  stops.forEach(([offset, color]) => el('stop', { offset, style: `stop-color: var(${color})` }, g));
}

export class Dial {
  /**
   * @param {SVGSVGElement} svg
   * @param {(info: null | {phase: 'day'|'night', hour: number, start: number, end: number}) => void} onHover
   */
  constructor(svg, onHover) {
    this.svg = svg;
    this.onHover = onHover;
    this.hovered = null;   // label under the mouse (preview only)
    this.selected = null;  // label picked by tap, click or keyboard; stays until toggled or cleared
    // Tapping or clicking anywhere outside an hour label clears the selection.
    document.addEventListener('pointerdown', (e) => {
      if (this.selected && !e.target.closest?.('#dial .hr')) this.#select(null);
    });
    this.labels = { day: [], night: [] };
    svg.setAttribute('viewBox', '-52 -22 504 446');

    const defs = el('defs', {}, svg);
    gradient(defs, 'g-day', [[0, '--day-1'], [0.5, '--day-2'], [1, '--day-3']]);
    gradient(defs, 'g-night', [[0, '--night-3'], [0.5, '--night-2'], [1, '--night-1']]);

    el('circle', { cx: C, cy: C, r: R_OUT + 8, class: 'face' }, svg);
    el('path', { d: sector(0, 180, R_IN, R_OUT), fill: 'url(#g-day)' }, svg);
    el('path', { d: sector(180, 360, R_IN, R_OUT), fill: 'url(#g-night)' }, svg);
    this.current = el('path', { class: 'current' }, svg);
    el('circle', { cx: C, cy: C, r: R_IN, class: 'face-inner' }, svg);

    const ticks = el('g', { class: 'ticks' }, svg);
    for (let i = 0; i < 24; i++) {
      const [x1, y1] = pt(i * 15, R_IN);
      const [x2, y2] = pt(i * 15, R_OUT);
      el('line', { x1, y1, x2, y2, class: i % 12 === 0 ? 'tick horizon' : 'tick' }, ticks);
    }

    const [dx, dy] = pt(90, 58), [nx, ny] = pt(270, 58);
    el('text', { x: dx, y: dy, class: 'half-name' }, svg).textContent = 'DAY';
    el('text', { x: nx, y: ny, class: 'half-name' }, svg).textContent = 'NIGHT';

    const hours = el('g', { class: 'hours' }, svg);
    for (const phase of ['day', 'night']) {
      for (let i = 1; i <= 12; i++) this.labels[phase][i] = this.#makeLabel(hours, phase, i);
    }

    this.hand = el('g', { class: 'hand' }, svg);
    el('line', { x1: C, y1: C, x2: C, y2: C + R_OUT - 4, class: 'hand-line' }, this.hand);
    this.marker = el('circle', { cx: C, cy: C + (R_IN + R_OUT) / 2, r: 11, class: 'marker' }, this.hand);
    el('circle', { cx: C, cy: C, r: 6, class: 'hub' }, svg);
  }

  #makeLabel(parent, phase, i) {
    const theta = thetaOf(phase, i);
    const g = el('g', { class: `hr ${phase}${MAJOR.has(i) ? ' major' : ''}`, tabindex: 0, role: 'button' }, parent);
    const [nx, ny] = pt(theta, R_NUM);
    // Tap/hover target: the whole 15° wedge around this label, from inside the numeral out past the ring.
    el('path', { d: sector(theta - 7.5, theta + 7.5, R_NUM - 18, R_OUT + 8), class: 'hit' }, g);
    el('circle', { cx: nx, cy: ny, r: 13, class: 'halo' }, g);
    el('circle', { cx: nx, cy: ny, r: 13, class: 'chip' }, g); // filled while this is the current hour
    el('text', { x: nx, y: ny, class: 'num' }, g).textContent = i;

    // Time label just outside the band, anchored away from the dial.
    const s = Math.sin(theta * Math.PI / 180);
    const anchor = Math.abs(s) < 0.2 ? 'middle' : s > 0 ? 'end' : 'start';
    const atTop = Math.abs(theta - 180) < 1;
    const [tx, ty] = pt(theta, R_TIME + (anchor === 'middle' ? 6 : 0));
    const time = el('text', { x: tx, y: ty, 'text-anchor': anchor, class: 'time' }, g);
    const caption = CAPTIONS[phase][i];
    if (caption) {
      const cy = atTop ? ty - 15 : ty + 15;
      el('text', { x: tx, y: cy, 'text-anchor': anchor, class: 'caption' }, g).textContent = caption;
    }

    const info = () => this.bounds && {
      phase, hour: i, start: this.bounds[phase][i - 1], end: this.bounds[phase][i],
    };
    const label = { g, time, info };
    // Mouse: hovering previews an hour. Touch devices send fake enter/leave around each tap, so
    // only real mouse pointers count as hover.
    g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.#hover(label); });
    g.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.#hover(null); });
    // Click or tap toggles the selection: tap once to show, tap again (or anywhere else) to hide.
    g.addEventListener('click', () => this.#select(this.selected === label ? null : label));
    // Keyboard: Tab onto an hour selects it, Enter/Space toggles, Esc or tabbing away clears.
    g.addEventListener('focus', () => { if (g.matches(':focus-visible')) this.#select(label); });
    g.addEventListener('blur', () => { if (this.selected === label && !g.matches(':hover')) this.#select(null); });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.#select(this.selected === label ? null : label); }
      if (e.key === 'Escape') this.#select(null);
    });
    return label;
  }

  #hover(label) {
    this.hovered?.g.classList.remove('hovered');
    this.hovered = label;
    label?.g.classList.add('hovered');
    this.#report();
  }

  #select(label) {
    this.selected?.g.classList.remove('selected');
    this.selected = label;
    label?.g.classList.add('selected');
    label?.g.setAttribute('aria-pressed', 'true');
    for (const p of ['day', 'night']) {
      for (let i = 1; i <= 12; i++) if (this.labels[p][i] !== label) this.labels[p][i].g.setAttribute('aria-pressed', 'false');
    }
    this.#report();
  }

  /** Tell the page which hour to describe: the hovered one, else the selected one, else none. */
  #report() {
    const l = this.hovered || this.selected;
    this.onHover(l ? l.info() : null);
  }

  /** Fill in boundary times; label i shows the moment hour i ends (day 6 = noon, day 12 = sunset). */
  setCycle(cycle, fmt) {
    this.bounds = cycle && { day: cycle.dayBounds, night: cycle.nightBounds };
    for (const phase of ['day', 'night']) {
      for (let i = 1; i <= 12; i++) {
        const { g, time } = this.labels[phase][i];
        if (!cycle) { time.textContent = ''; g.removeAttribute('aria-label'); continue; }
        const b = this.bounds[phase];
        time.textContent = fmt(b[i]);
        g.setAttribute('aria-label', `${phase} hour ${i}: ${fmt(b[i - 1])} to ${fmt(b[i])}`);
      }
    }
  }

  /** @param {number} position 0-1 around the dial, clockwise from sunrise. */
  setNow(position, isDay, hour) {
    this.hand.setAttribute('transform', `rotate(${(position * 360).toFixed(3)} ${C} ${C})`);
    this.svg.classList.toggle('is-night', !isDay);
    const phase = isDay ? 'day' : 'night';
    const t0 = thetaOf(phase, hour - 1);
    this.current.setAttribute('d', sector(t0, t0 + 15, R_IN, R_OUT));
    if (this.nowLabel !== this.labels[phase][hour]) {
      this.nowLabel?.g.classList.remove('now');
      this.nowLabel = this.labels[phase][hour];
      this.nowLabel.g.classList.add('now');
    }
  }
}
