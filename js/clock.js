// SVG solar dial.
// Angles are measured in degrees clockwise from the bottom of the dial:
//   0 = bottom, 90 = left, 180 = top, 270 = right.
// Three layouts, matching cycle.kind from solar.js:
//   normal       day hours fill the left half bottom -> top (sunrise -> sunset),
//                night hours the right half top -> bottom (sunset -> sunrise); 15° per hour.
//   polar-day    12 day hours round the whole ring from the bottom (solar midnight);
//                the 6th ends at the top (solar noon); 30° per hour.
//   polar-night  12 night hours round the whole ring from the top (solar noon);
//                the 6th ends at the bottom (solar midnight); 30° per hour.

const NS = 'http://www.w3.org/2000/svg';
const C = 200;
const R_OUT = 170;        // outer edge of the hour band
const R_IN = 122;         // inner edge of the hour band
const R_NUM = 102;        // hour numerals
const R_TIME = 186;       // time labels outside the band
const MAJOR = new Set([3, 6, 9, 12]);

const LAYOUTS = {
  normal: {
    phases: ['day', 'night'],
    start: { day: 0, night: 180 }, step: 15,
    ring: [['g-day', 0, 180], ['g-night', 180, 360]],
    captions: { day: { 6: 'noon', 12: 'sunset' }, night: { 6: 'midnight', 12: 'sunrise' } },
    names: [['DAY', 90], ['NIGHT', 270]],
  },
  'polar-day': {
    phases: ['day'],
    start: { day: 0 }, step: 30,
    // Colours follow the hours round the ring: sunrise orange -> noon gold (top) -> sunset coral.
    conic: { start: 0, colors: ['--day-1', '--day-2', '--day-3'] },
    captions: { day: { 6: 'noon' } },
    names: [['DAY', 180]],    // above the hub, towards solar noon
  },
  'polar-night': {
    phases: ['night'],
    start: { night: 180 }, step: 30,
    // Colours follow the hours round the ring: dusk violet -> midnight navy (bottom) -> dawn blue.
    conic: { start: 180, colors: ['--night-1', '--night-2', '--night-3'] },
    captions: { night: { 6: 'midnight' } },
    names: [['NIGHT', 0]],    // below the hub, towards solar midnight
  },
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
    svg.setAttribute('viewBox', '-52 -22 504 446');

    const defs = el('defs', {}, svg);
    gradient(defs, 'g-day', [[0, '--day-1'], [0.5, '--day-2'], [1, '--day-3']]);
    gradient(defs, 'g-night', [[0, '--night-3'], [0.5, '--night-2'], [1, '--night-1']]);

    el('circle', { cx: C, cy: C, r: R_OUT + 8, class: 'face' }, svg);
    this.ringG = el('g', {}, svg);
    this.current = el('path', { class: 'current' }, svg);
    el('circle', { cx: C, cy: C, r: R_IN, class: 'face-inner' }, svg);
    this.ticksG = el('g', { class: 'ticks' }, svg);
    this.namesG = el('g', {}, svg);
    this.hoursG = el('g', { class: 'hours' }, svg);

    this.hand = el('g', { class: 'hand' }, svg);
    el('line', { x1: C, y1: C, x2: C, y2: C + R_OUT - 4, class: 'hand-line' }, this.hand);
    this.marker = el('circle', { cx: C, cy: C + (R_IN + R_OUT) / 2, r: 11, class: 'marker' }, this.hand);
    el('circle', { cx: C, cy: C, r: 6, class: 'hub' }, svg);

    this.#layout('normal');
  }

  /** Angle (deg) where hour i of `phase` ends in the current layout. */
  #theta(phase, i) {
    return this.layout.start[phase] + this.layout.step * i;
  }

  /** Draw the ring, ticks, half names and hour labels for one layout. */
  #layout(kind) {
    if (this.kind === kind) return;
    this.kind = kind;
    this.layout = LAYOUTS[kind];
    const L = this.layout;
    this.hovered = null;
    this.selected = null;
    this.nowLabel = null;
    for (const g of [this.ringG, this.ticksG, this.namesG, this.hoursG]) g.replaceChildren();

    if (L.ring) {
      for (const [grad, a, b] of L.ring) el('path', { d: sector(a, b, R_IN, R_OUT), fill: `url(#${grad})` }, this.ringG);
    } else {
      // SVG has no angular gradient: build the ring from thin wedges, each a mix of the theme colours.
      const { start, colors: [c1, c2, c3] } = L.conic, N = 120, w = 360 / N;
      for (let j = 0; j < N; j++) {
        const f = (j + 0.5) / N; // position along the 12 hours, 0 -> 1
        const [a, b, x] = f < 0.5 ? [c1, c2, f * 2] : [c2, c3, f * 2 - 1];
        const color = `color-mix(in srgb, var(${a}) ${((1 - x) * 100).toFixed(1)}%, var(${b}))`;
        const t0 = start + j * w;
        el('path', { d: sector(t0, t0 + w, R_IN, R_OUT), style: `fill: ${color}; stroke: ${color}; stroke-width: 0.6` }, this.ringG);
      }
    }
    for (let a = 0; a < 360; a += L.step) {
      const [x1, y1] = pt(a, R_IN), [x2, y2] = pt(a, R_OUT);
      const horizon = kind === 'normal' && a % 180 === 0; // sunrise and sunset lines
      el('line', { x1, y1, x2, y2, class: horizon ? 'tick horizon' : 'tick' }, this.ticksG);
    }
    for (const [text, a] of L.names) {
      const [x, y] = pt(a, 58); // 58 units from the centre, at angle a
      el('text', { x, y, class: 'half-name' }, this.namesG).textContent = text;
    }

    this.labels = {};
    for (const phase of L.phases) {
      this.labels[phase] = [];
      for (let i = 1; i <= 12; i++) this.labels[phase][i] = this.#makeLabel(this.hoursG, phase, i);
    }
    this.#report();
  }

  #makeLabel(parent, phase, i) {
    const theta = this.#theta(phase, i) % 360;
    const half = this.layout.step / 2;
    const g = el('g', { class: `hr ${phase}${MAJOR.has(i) ? ' major' : ''}`, tabindex: 0, role: 'button' }, parent);
    const [nx, ny] = pt(theta, R_NUM);
    // Tap/hover target: the whole wedge around this label, from inside the numeral out past the ring.
    el('path', { d: sector(theta - half, theta + half, R_NUM - 18, R_OUT + 8), class: 'hit' }, g);
    el('circle', { cx: nx, cy: ny, r: 13, class: 'halo' }, g);
    el('circle', { cx: nx, cy: ny, r: 13, class: 'chip' }, g); // filled while this is the current hour
    el('text', { x: nx, y: ny, class: 'num' }, g).textContent = i;

    // Time label just outside the band, anchored away from the dial.
    const s = Math.sin(theta * Math.PI / 180);
    const anchor = Math.abs(s) < 0.2 ? 'middle' : s > 0 ? 'end' : 'start';
    const atTop = Math.abs(theta - 180) < 1;
    const [tx, ty] = pt(theta, R_TIME + (anchor === 'middle' ? 6 : 0));
    const time = el('text', { x: tx, y: ty, 'text-anchor': anchor, class: 'time' }, g);
    const caption = this.layout.captions[phase]?.[i];
    if (caption) {
      const cy = atTop ? ty - 15 : ty + 15;
      el('text', { x: tx, y: cy, 'text-anchor': anchor, class: 'caption' }, g).textContent = caption;
    }

    const info = () => this.bounds?.[phase] && {
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
    for (const p of this.layout.phases) {
      for (let i = 1; i <= 12; i++) if (this.labels[p][i] !== label) this.labels[p][i].g.setAttribute('aria-pressed', 'false');
    }
    this.#report();
  }

  /** Tell the page which hour to describe: the hovered one, else the selected one, else none. */
  #report() {
    const l = this.hovered || this.selected;
    this.onHover(l ? l.info() : null);
  }

  /**
   * Switch to the cycle's layout and fill in boundary times; label i shows the moment hour i ends.
   * A half that is missing (null bounds) is drawn without times.
   */
  setCycle(cycle, fmt) {
    this.#layout(cycle?.kind ?? 'normal');
    this.bounds = cycle && { day: cycle.dayBounds, night: cycle.nightBounds };
    for (const phase of this.layout.phases) {
      for (let i = 1; i <= 12; i++) {
        const { g, time } = this.labels[phase][i];
        const b = this.bounds?.[phase];
        if (!b) { time.textContent = ''; g.removeAttribute('aria-label'); continue; }
        time.textContent = fmt(b[i]);
        g.setAttribute('aria-label', `${phase} hour ${i}: ${fmt(b[i - 1])} to ${fmt(b[i])}`);
      }
    }
    this.#report();
  }

  /** @param {number} position 0-1 around the dial, clockwise from the bottom. */
  setNow(position, isDay, hour) {
    this.hand.setAttribute('transform', `rotate(${(position * 360).toFixed(3)} ${C} ${C})`);
    this.svg.classList.toggle('is-night', !isDay);
    const phase = isDay ? 'day' : 'night';
    const t0 = this.#theta(phase, hour - 1);
    this.current.setAttribute('d', sector(t0, t0 + this.layout.step, R_IN, R_OUT));
    const label = this.labels[phase]?.[hour];
    if (this.nowLabel !== label) {
      this.nowLabel?.g.classList.remove('now');
      this.nowLabel = label;
      label?.g.classList.add('now');
    }
  }
}
