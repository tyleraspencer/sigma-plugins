// Marimekko (mosaic) chart.
//
// Two measures in one plot. Column WIDTH is the category's share of the grand
// total; segment HEIGHT is that segment's share within the column. So a wide
// column is a big region and a tall segment is a dominant product family --
// and the area of any tile is its share of everything.
//
// Reading rule: compare heights DOWN a column (mix), widths ACROSS columns
// (size). Comparing a tile in one column to a tile in another compares areas,
// which is what the chart is for but is the slowest read -- hence the tooltip.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  client,
  useConfig,
  useElementData,
  useVariable,
  useLoadingState,
} from '@sigmacomputing/plugin';

// Declared at module scope. Each `name` is the key the value arrives under in
// `config` AND the key a workbook spec's plugin `config` must use -- renaming
// one silently unbinds every workbook already using it.
//
// Three column bindings, not two: a mekko needs the column dimension, the
// stacking dimension and the measure. `--data` rows must carry headers named
// `category`, `segment` and `value` for all three to bind.
client.config.configureEditorPanel([
  { type: 'element', name: 'source' },
  { type: 'column', name: 'category', source: 'source', allowMultiple: false,
    allowedTypes: ['text'] },
  { type: 'column', name: 'segment', source: 'source', allowMultiple: false,
    allowedTypes: ['text'] },
  { type: 'column', name: 'value', source: 'source', allowMultiple: false,
    allowedTypes: ['number', 'integer'] },

  { type: 'group', name: 'Style' },
  { type: 'dropdown', name: 'maxSegments', source: 'Style',
    values: ['4', '5', '6', '8', 'All'], defaultValue: '6' },
  { type: 'dropdown', name: 'sortColumns', source: 'Style',
    values: ['Width, wide to narrow', 'Width, narrow to wide', 'Category A-Z'],
    defaultValue: 'Width, wide to narrow' },
  { type: 'toggle', name: 'showTileLabels', source: 'Style', defaultValue: true },
  { type: 'toggle', name: 'showAxis', source: 'Style', defaultValue: true },

  // Two-way channel to a workbook control: clicking a tile writes its segment
  // name into the control, so the rest of the workbook can filter on it.
  { type: 'variable', name: 'selectedSegment', allowedTypes: ['text'] },
]);

// Categorical slots in FIXED order -- assigned by segment identity, never by
// rank, so filtering the data does not repaint the survivors. This ordering is
// the CVD-safety mechanism: it clears the adjacent-pair gates that a stacked
// chart is judged on. Do not re-order to "look nicer".
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100',
                 '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#9ca3af';

const INK = '#0b0b0b';
const INK_2 = '#52514e';
const INK_MUTED = '#8a8984';
const SURFACE = '#ffffff';

// Plugs Electronics, so an unbound frame in the editor still reads as this
// chart rather than as an error. Deterministic -- a fallback that reshuffles
// cannot be screenshotted or eyeballed for regressions.
const DEMO = (() => {
  const cats = [
    ['West', [128, 92, 61, 44, 30, 18]],
    ['Northeast', [96, 58, 72, 26, 41, 12]],
    ['Southeast', [74, 66, 38, 39, 21, 15]],
    ['Midwest', [52, 47, 44, 18, 16, 9]],
    ['Mountain', [28, 19, 33, 12, 10, 6]],
  ];
  const segs = ['Audio', 'Charging', 'Wearables', 'Storage', 'Cables', 'Mounts'];
  const out = [];
  for (const [category, vals] of cats) {
    vals.forEach((v, i) => out.push({ category, segment: segs[i], value: v * 1000 }));
  }
  return out;
})();

const fmt = (v) => {
  const n = Number(v) || 0, a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Math.round(n)}`;
};
const pct = (x) => `${(x * 100).toFixed(x >= 0.1 ? 0 : 1)}%`;

// 2px of surface between every fill, so adjacent tiles never share an edge.
const GAP = 2;

// Three of the categorical slots are light enough that white tile text on them
// is unreadable. Pick the ink from the fill's luminance rather than assuming
// every series is dark.
// Category labels sit under columns whose width is the data, so a long name in
// a narrow column runs into its neighbour. Approximate the 10px label's advance
// width -- an SVG <text> does not wrap or ellipsize on its own -- and return
// '' when even a truncation would not fit, so the label is dropped entirely
// rather than overlapping. The tooltip still names every tile.
const CHAR_W = 5.4;
function clip(text, boxW) {
  const max = Math.floor((boxW - 6) / CHAR_W);
  if (max < 4) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// Prefer "Name · 23%"; drop the share before truncating the name, since a
// truncated name is the thing that stops being identifiable.
function columnLabel(category, share, boxW) {
  const full = `${category} · ${pct(share)}`;
  const max = Math.floor((boxW - 6) / CHAR_W);
  return full.length <= max ? full : clip(category, boxW);
}

// These in-tile labels are the relief that makes the three low-contrast
// categorical slots legal, so they have to be readable on every fill -- and
// half this palette is light enough that white-on-fill is not. Compute the
// WCAG contrast of both inks against the fill and take the winner rather than
// picking a luminance cutoff by eye: the crossover sits near L 0.2, far darker
// than it looks, and eyeballing it puts white on the orange and the magenta.
const DARK_INK = '#1a1a19';
function luminance(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(((n >> 16) & 255) / 255)
       + 0.7152 * lin(((n >> 8) & 255) / 255)
       + 0.0722 * lin((n & 255) / 255);
}
const DARK_L = luminance(DARK_INK);
function inkOn(hex) {
  const L = luminance(hex);
  const onWhite = 1.05 / (L + 0.05);
  const onDark = (L + 0.05) / (DARK_L + 0.05);
  return onDark > onWhite ? DARK_INK : '#ffffff';
}

export default function App() {
  const config = useConfig();

  // Data arrives KEYED BY COLUMN ID -- an object of parallel arrays, not row
  // objects. Zip by index.
  const sigmaData = useElementData(config.source);

  const [variable, setVariable] = useVariable(config.selectedSegment);
  const [, setLoading] = useLoadingState(true);

  // The CURRENT value of a variable lives at .defaultValue.value, despite the
  // name. Reading `.value` gets you undefined.
  const selected = variable?.defaultValue?.value ?? null;

  const [hover, setHover] = useState(null);

  const rows = useMemo(() => {
    const cats = sigmaData?.[config.category];
    const segs = sigmaData?.[config.segment];
    const vals = sigmaData?.[config.value];
    if (!cats || !segs || !vals) return null;
    const out = [];
    for (let i = 0; i < vals.length; i++) {
      const v = Number(vals[i]);
      // A negative tile has no area to draw, and one negative in a stack makes
      // every share in that column meaningless. Drop them rather than lie.
      if (!Number.isFinite(v) || v <= 0) continue;
      out.push({
        category: String(cats[i] ?? '—'),
        segment: String(segs[i] ?? '—'),
        value: v,
      });
    }
    return out.length ? out : null;
  }, [sigmaData, config.category, config.segment, config.value]);

  useEffect(() => { setLoading(false); }, [rows, setLoading]);

  const isDemo = !rows && !config.source;
  const data = rows ?? (isDemo ? DEMO : []);

  // Every dimension of this chart comes from the measured box, so the observer
  // IS the layout. Measure the plot box ITSELF rather than the iframe minus a
  // guess at the chrome: the title, legend and tooltip strip wrap at narrow
  // widths, so any subtracted constant is wrong at some size and the mosaic
  // silently overflows the bottom of the frame.
  //
  // Guard it: the callback re-renders into the element it observes, and
  // without the comparison that is an infinite loop. The box cannot grow from
  // its own content either -- `flex: 1; minHeight: 0; overflow: hidden` -- so
  // the guard has a fixed point to settle on.
  // A CALLBACK ref, not useRef + useEffect([]): the plot box is absent on the
  // "nothing bound yet" render, so an effect that ran once at mount would
  // never see the element that appears when data arrives.
  const [size, setSize] = useState({ w: 0, h: 0 });
  const lastSize = useRef({ w: 0, h: 0 });
  const observer = useRef(null);
  const plotRef = React.useCallback((el) => {
    if (observer.current) { observer.current.disconnect(); observer.current = null; }
    if (!el || !window.ResizeObserver) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === lastSize.current.w && h === lastSize.current.h) return;
      lastSize.current = { w, h };
      setSize({ w, h });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observer.current = ro;
    measure();
  }, []);

  // --- the mosaic ---------------------------------------------------------
  // Aggregate first: the same (category, segment) can arrive on several rows
  // when the bound element is ungrouped, and a mekko that draws one tile per
  // ROW instead of per pair silently stripes every column.
  const model = useMemo(() => {
    const byCat = new Map();
    const segTotals = new Map();
    for (const r of data) {
      if (!byCat.has(r.category)) byCat.set(r.category, new Map());
      const m = byCat.get(r.category);
      m.set(r.segment, (m.get(r.segment) || 0) + r.value);
      segTotals.set(r.segment, (segTotals.get(r.segment) || 0) + r.value);
    }

    // Segment order is global and fixed by total size, so a colour means the
    // same thing in every column. Everything past the cap folds into "Other".
    const cap = config.maxSegments === 'All'
      ? Infinity
      : Number(config.maxSegments || 6);
    const ranked = [...segTotals.entries()].sort((a, b) => b[1] - a[1]);
    const kept = Number.isFinite(cap) ? ranked.slice(0, cap) : ranked;
    const folded = Number.isFinite(cap) ? ranked.slice(cap) : [];
    const foldedNames = new Set(folded.map(([n]) => n));

    const order = kept.map(([name], i) => ({ name, color: PALETTE[i % PALETTE.length] }));
    if (folded.length) order.push({ name: 'Other', color: OTHER_COLOR, isOther: true });

    let grand = 0;
    const columns = [];
    for (const [category, m] of byCat) {
      const parts = [];
      let otherSum = 0;
      let total = 0;
      for (const [segment, value] of m) {
        total += value;
        if (foldedNames.has(segment)) otherSum += value;
      }
      if (total <= 0) continue;
      for (const { name, isOther } of order) {
        const value = isOther ? otherSum : (m.get(name) || 0);
        if (value > 0) parts.push({ segment: name, value, isOther: !!isOther });
      }
      grand += total;
      columns.push({ category, total, parts });
    }

    const dir = config.sortColumns || 'Width, wide to narrow';
    if (dir === 'Category A-Z') columns.sort((a, b) => a.category.localeCompare(b.category));
    else if (dir === 'Width, narrow to wide') columns.sort((a, b) => a.total - b.total);
    else columns.sort((a, b) => b.total - a.total);

    return { columns, order, grand };
  }, [data, config.maxSegments, config.sortColumns]);

  const colorOf = useMemo(() => {
    const m = new Map(model.order.map((o) => [o.name, o.color]));
    return (name) => m.get(name) || OTHER_COLOR;
  }, [model.order]);

  const pick = (segment, isOther) => {
    if (!config.selectedSegment || isOther) return;  // "Other" is not a member
    if (String(segment) === String(selected)) setVariable();
    else setVariable(String(segment));
  };

  if (!model.columns.length || model.grand <= 0) {
    return (
      <div style={S.hint}>
        {client.sigmaEnv === 'author'
          ? 'Bind an element, then a category column, a segment column and a positive value column in the editor panel.'
          : 'No data to display.'}
      </div>
    );
  }

  // First paint reports 0. Draw at a usable default and re-draw on the real
  // measurement rather than waiting for one -- a chart that waits renders
  // nothing in a frame whose size never changes again.
  const boxW = size.w > 0 ? size.w : 640;
  const boxH = size.h > 0 ? size.h : 300;

  const axisOn = config.showAxis !== false && boxW >= 300;
  const axisW = axisOn ? 34 : 0;
  const topPad = 6;                       // the 100% tick is centred on y=0
  const footH = 16;                       // the category labels under the mosaic

  const plotW = Math.max(40, boxW - axisW);
  const plotH = Math.max(24, boxH - topPad - footH);

  // Widths are shares of the grand total, less the gaps -- take the gaps out of
  // the available width first so the columns still sum to exactly plotW.
  const nGaps = Math.max(0, model.columns.length - 1);
  const usableW = Math.max(20, plotW - nGaps * GAP);

  let x = 0;
  const tiles = [];
  const columnBoxes = [];
  for (const col of model.columns) {
    const w = (col.total / model.grand) * usableW;
    const segGaps = Math.max(0, col.parts.length - 1);
    const usableH = Math.max(4, plotH - segGaps * GAP);
    let y = 0;
    for (const p of col.parts) {
      const h = (p.value / col.total) * usableH;
      tiles.push({
        key: `${col.category}|${p.segment}`,
        x, y, w, h,
        category: col.category,
        segment: p.segment,
        value: p.value,
        isOther: p.isOther,
        shareOfColumn: p.value / col.total,
        shareOfAll: p.value / model.grand,
      });
      y += h + GAP;
    }
    columnBoxes.push({ x, w, category: col.category, total: col.total,
                       share: col.total / model.grand });
    x += w + GAP;
  }

  const dimmed = (segment) => selected != null && String(segment) !== String(selected);

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div style={S.title}>Revenue Mix Mekko</div>
        <div style={S.topRight}>
          {isDemo && <div style={S.badge}>demo data</div>}
          <div style={S.total}>{fmt(model.grand)}</div>
        </div>
      </div>

      <div style={S.body} ref={plotRef}>
        <svg
          width={boxW}
          height={boxH}
          role="img"
          aria-label="Marimekko chart: column width is share of total, segment height is mix within the column"
          onMouseLeave={() => setHover(null)}
        >
          {/* Recessive axis: the mix percentages the heights encode. */}
          {axisOn && [0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={`ax-${t}`}>
              <text x={axisW - 8} y={topPad + plotH * t} textAnchor="end"
                    dominantBaseline="middle" style={S.axisText}>
                {`${Math.round((1 - t) * 100)}%`}
              </text>
              <line x1={axisW - 4} x2={axisW - 1}
                    y1={topPad + plotH * t} y2={topPad + plotH * t}
                    stroke="#e5e4e0" strokeWidth="1" />
            </g>
          ))}

          <g transform={`translate(${axisW},${topPad})`}>
            {tiles.map((t) => {
              const isDim = dimmed(t.segment);
              const labelFits = config.showTileLabels !== false &&
                                t.w >= 46 && t.h >= 18 && t.shareOfColumn >= 0.07;
              return (
                <g key={t.key}>
                  <rect
                    x={t.x} y={t.y} width={Math.max(0, t.w)} height={Math.max(0, t.h)}
                    rx={2}
                    fill={colorOf(t.segment)}
                    opacity={isDim ? 0.25 : 1}
                    style={{ cursor: t.isOther || !config.selectedSegment ? 'default' : 'pointer' }}
                    onMouseEnter={() => setHover(t)}
                    onClick={() => pick(t.segment, t.isOther)}
                  />
                  {labelFits && (
                    <text
                      x={t.x + t.w / 2} y={t.y + t.h / 2}
                      textAnchor="middle" dominantBaseline="central"
                      style={{ ...S.tileText, fill: inkOn(colorOf(t.segment)) }}
                      opacity={isDim ? 0.35 : 1}
                      pointerEvents="none"
                    >
                      {pct(t.shareOfColumn)}
                    </text>
                  )}
                  {/* A 2px surface ring on the hovered tile, rather than a
                      colour change -- the fill is the identity encoding. */}
                  {hover && hover.key === t.key && (
                    <rect
                      x={t.x} y={t.y} width={Math.max(0, t.w)} height={Math.max(0, t.h)}
                      rx={2} fill="none" stroke={INK} strokeWidth="2"
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}

            {/* Category labels carry the width encoding in words, because a
                width difference under ~15% is not readable as a width. */}
            {columnBoxes.map((c) => {
              const label = columnLabel(c.category, c.share, c.w);
              if (!label) return null;
              return (
                <text key={`cat-${c.category}`}
                      x={c.x + c.w / 2} y={plotH + 11}
                      textAnchor="middle" style={S.catText}>
                  {label}
                </text>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Identity is never colour-alone: the legend is always present, and the
          hovered tile names its own segment in the tooltip strip. */}
      <div style={S.legend}>
        {model.order.map((o) => {
          const isDim = dimmed(o.name);
          return (
            <div
              key={`lg-${o.name}`}
              style={{ ...S.legendItem,
                       opacity: isDim ? 0.4 : 1,
                       cursor: o.isOther || !config.selectedSegment ? 'default' : 'pointer' }}
              onClick={() => pick(o.name, o.isOther)}
            >
              <span style={{ ...S.swatch, background: o.color }} />
              <span style={S.legendLabel} title={o.name}>{o.name}</span>
            </div>
          );
        })}
      </div>

      <div style={S.tip}>
        {hover
          ? `${hover.category} · ${hover.segment} — ${fmt(hover.value)} · ` +
            `${pct(hover.shareOfColumn)} of ${hover.category} · ${pct(hover.shareOfAll)} of total`
          : 'Width = share of total revenue. Height = mix within the column.'}
      </div>
    </div>
  );
}

const S = {
  wrap: { height: '100%', display: 'flex', flexDirection: 'column',
          padding: '10px 14px 8px', gap: 6, background: SURFACE },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
         flex: '0 0 auto', gap: 10 },
  title: { fontSize: 12, fontWeight: 700, letterSpacing: '.05em',
           textTransform: 'uppercase', color: INK_2 },
  topRight: { display: 'flex', alignItems: 'center', gap: 8 },
  total: { fontSize: 13, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' },
  badge: { fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
           padding: '2px 6px', borderRadius: 3, background: '#fef3c7', color: '#92400e' },
  // minHeight 0, or this growing child refuses to shrink below the SVG inside
  // it and the plugin spills past the bottom of the iframe.
  body: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', overflow: 'hidden' },
  legend: { flex: '0 0 auto', display: 'flex', flexWrap: 'wrap', gap: '2px 12px',
            alignItems: 'center' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5 },
  swatch: { width: 9, height: 9, borderRadius: 2, flex: '0 0 auto' },
  legendLabel: { fontSize: 10, color: INK_2, whiteSpace: 'nowrap' },
  tip: { flex: '0 0 auto', fontSize: 10, color: INK_MUTED, whiteSpace: 'nowrap',
         overflow: 'hidden', textOverflow: 'ellipsis' },
  axisText: { fontSize: 9, fill: INK_MUTED, fontVariantNumeric: 'tabular-nums' },
  catText: { fontSize: 10, fill: INK_2 },
  tileText: { fontSize: 10, fontWeight: 600, fill: '#ffffff',
              fontVariantNumeric: 'tabular-nums' },
  hint: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', fontSize: 11, color: INK_MUTED, padding: '0 24px',
          lineHeight: 1.6 },
};
