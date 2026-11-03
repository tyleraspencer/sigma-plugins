import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  client,
  useConfig,
  useElementData,
  useVariable,
  useLoadingState,
  usePluginStyle,
} from '@sigmacomputing/plugin';

// A drop-in lookalike of Sigma's native multiselect list control, whose one job
// is to be a *visible, writable face* for a real multiselect control:
//
//   table button --set-control-value--> [real control] <--variable--> this plugin
//
// The plugin never owns the selection. It reads the bound control through
// `useVariable` (so a button action that sets the control repaints the
// dropdown) and writes through the same variable when the user ticks a box
// (so every element filtering on the control follows).

// Sigma design tokens -- docs/design-system.md. The control neutrals below are
// measured off Sigma's own list control (light gray hairlines, near-white
// field); the checked state wears the shared accent.
const T = {
  card: '#ffffff',
  field: '#fcfcfc',          // the input and panel surface
  ink: '#1a1a1a',            // value text, label
  placeholder: '#6b6b6b',    // "Select values", "Search", null
  hairline: '#dedede',       // outer border, row dividers
  hover: '#f2f2f2',          // row hover, menu hover
  box: '#b8b8b8',            // unchecked checkbox border
  accent: '#274690', accentTint: '#eaf0fb',
  onAccent: '#ffffff',
  warn: '#b45309', warnTint: '#fdf1e3',
};

const FONT = '"Source Sans Pro", "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

// Declared once, at module scope. Renaming a `name` silently unbinds every
// workbook already using it.
client.config.configureEditorPanel([
  { type: 'element', name: 'source' },
  // Where the dropdown's choices come from: the distinct values of this column.
  { type: 'column', name: 'options', source: 'source', allowMultiple: false,
    allowedTypes: ['text'] },

  { type: 'group', name: 'Appearance' },
  { type: 'text', name: 'label', source: 'Appearance', defaultValue: 'Product Type',
    placeholder: 'Shown above the dropdown; leave empty to hide' },
  { type: 'toggle', name: 'keepOpen', source: 'Appearance', defaultValue: false },

  // Two-way channel to the real multiselect control. 'text-list' is a LIST
  // control; plain 'text' would be a text INPUT box.
  { type: 'variable', name: 'selected', allowedTypes: ['text-list'] },
]);

// Mirrors the screenshots this plugin was built from. Only ever shown while no
// element is bound, and badged so nobody mistakes it for real data.
const DEMO = [null, 'Music', 'Photography', 'Arts & Entertainment', 'Entertainment',
  'Computers', 'Mobiles', 'Home Audio', 'Video Games'];

const NULL_KEY = '\u0000null';
const keyOf = (v) => (v == null ? NULL_KEY : String(v));
const textOf = (v) => (v == null ? 'null' : String(v));

const SORTS = [
  { id: 'order', label: 'Original order' },
  { id: 'asc', label: 'Sort A to Z' },
  { id: 'desc', label: 'Sort Z to A' },
];

function Check({ state }) {
  // state: 'on' | 'part' | 'off'
  const on = state !== 'off';
  return (
    <span style={{ ...S.check, background: on ? T.accent : T.field,
                   borderColor: on ? T.accent : T.box }}>
      {state === 'on' && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={T.onAccent}
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1.8,5.2 4,7.4 8.2,2.8" />
        </svg>
      )}
      {state === 'part' && (
        <svg width="10" height="10" viewBox="0 0 10 10" stroke={T.onAccent} strokeWidth="1.8"
             strokeLinecap="round"><line x1="2" y1="5" x2="8" y2="5" /></svg>
      )}
    </span>
  );
}

const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink} strokeWidth="1.4"
       strokeLinecap="round" strokeLinejoin="round"><polyline points="2.5,4.5 6,8 9.5,4.5" /></svg>
);

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={T.placeholder}
       strokeWidth="1.4" strokeLinecap="round">
    <circle cx="8.5" cy="8.5" r="5.5" /><line x1="12.6" y1="12.6" x2="17" y2="17" />
  </svg>
);

const SortIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={T.ink} strokeWidth="1.4"
       strokeLinecap="round">
    <line x1="2" y1="1.5" x2="2" y2="14.5" /><line x1="5.5" y1="3" x2="14" y2="3" />
    <line x1="5.5" y1="7" x2="11" y2="7" /><line x1="5.5" y1="11" x2="8" y2="11" />
  </svg>
);

export default function App() {
  const config = useConfig();
  const sigmaData = useElementData(config.source);
  const [variable, setVariable] = useVariable(config.selected);
  const [, setLoading] = useLoadingState(true);
  const surface = usePluginStyle()?.backgroundColor || T.card;

  const bound = !!config.selected;
  const isDemo = !config.source;

  // Unbound (editor preview, or the author has not wired a control yet): keep
  // the selection locally so the dropdown is still clickable.
  const [localSel, setLocalSel] = useState([]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('order');
  const [sortMenu, setSortMenu] = useState(false);
  const boxRef = useRef(null);
  const searchRef = useRef(null);

  // The CURRENT value of a variable is at .defaultValue.value, despite the
  // name. A list control's value is an array; a cleared one may be null.
  const raw = variable?.defaultValue?.value;
  const selected = useMemo(() => {
    if (!bound) return localSel;
    if (raw == null) return [];
    return (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== undefined);
  }, [bound, raw, localSel]);
  const selectedKeys = useMemo(() => new Set(selected.map(keyOf)), [selected]);

  // Distinct values of the options column, in first-seen order. Data arrives
  // keyed by column id as parallel arrays.
  const options = useMemo(() => {
    if (isDemo) return DEMO;
    const col = sigmaData?.[config.options];
    if (!col) return null;
    const seen = new Set();
    const out = [];
    for (const v of col) {
      const k = keyOf(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v === undefined ? null : v);
    }
    return out;
  }, [isDemo, sigmaData, config.options]);

  useEffect(() => { setLoading(false); }, [options, setLoading]);

  const visible = useMemo(() => {
    if (!options) return [];
    const q = query.trim().toLowerCase();
    let list = q ? options.filter((v) => textOf(v).toLowerCase().includes(q)) : options.slice();
    if (sort !== 'order') {
      const nulls = list.filter((v) => v == null);
      const rest = list.filter((v) => v != null)
        .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      if (sort === 'desc') rest.reverse();
      list = sort === 'desc' ? [...rest, ...nulls] : [...nulls, ...rest];
    }
    return list;
  }, [options, query, sort]);

  const commit = (next) => {
    if (bound) setVariable(...next.map((v) => (v == null ? null : String(v))));
    else setLocalSel(next);
  };

  const toggle = (v) => {
    const k = keyOf(v);
    commit(selectedKeys.has(k) ? selected.filter((s) => keyOf(s) !== k) : [...selected, v]);
  };

  const visibleKeys = visible.map(keyOf);
  const nSelVisible = visibleKeys.filter((k) => selectedKeys.has(k)).length;
  const allState = !visible.length || nSelVisible === 0 ? 'off'
    : nSelVisible === visible.length ? 'on' : 'part';

  const toggleAll = () => {
    if (allState === 'on') {
      const drop = new Set(visibleKeys);
      commit(selected.filter((s) => !drop.has(keyOf(s))));
    } else {
      commit([...selected, ...visible.filter((v) => !selectedKeys.has(keyOf(v)))]);
    }
  };

  const expanded = open || config.keepOpen === true;

  // Close on a click outside, on Escape, and when focus leaves the iframe.
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setSortMenu(false); } };
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); setSortMenu(false); } };
    const blur = () => { setOpen(false); setSortMenu(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
    if (!expanded) { setQuery(''); setSortMenu(false); }
  }, [open, expanded]);

  const label = config.label === undefined ? 'Product Type' : config.label;

  if (!isDemo && options && !config.options) {
    return (
      <div style={{ ...S.hint, background: surface }}>
        {client.sigmaEnv === 'author'
          ? 'Pick the column that holds the dropdown choices in the editor panel.'
          : 'No data to display.'}
      </div>
    );
  }

  const summary = selected.map(textOf).join(', ');

  return (
    <div style={{ ...S.wrap, background: surface }}>
      {(label || isDemo) && (
        <div style={S.top}>
          <div style={S.label}>{label}</div>
          {isDemo && <div style={S.badge}>demo data</div>}
        </div>
      )}

      <div ref={boxRef} style={S.box}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          style={S.header}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
        >
          <span style={{ ...S.headerText, color: selected.length ? T.ink : T.placeholder }}
                title={summary}>
            {selected.length ? summary : 'Select values'}
          </span>
          {selected.length > 1 && <span style={S.count}>{selected.length}</span>}
          {selected.length > 0 && (
            <span
              role="button"
              aria-label="Clear selection"
              style={S.clear}
              onClick={(e) => { e.stopPropagation(); commit([]); }}
            >×</span>
          )}
          {!expanded && <span style={S.chev}><Chevron /></span>}
        </div>

        {expanded && (
          <>
            <div style={S.searchRow}>
              <span style={S.searchIcon}><SearchIcon /></span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                style={S.search}
              />
              <div style={{ position: 'relative', flex: '0 0 auto' }}>
                <span
                  role="button"
                  aria-label="Sort"
                  style={S.sortBtn}
                  onClick={() => setSortMenu((m) => !m)}
                ><SortIcon /><Chevron /></span>
                {sortMenu && (
                  <div style={S.menu}>
                    {SORTS.map((s) => (
                      <div
                        key={s.id}
                        style={{ ...S.menuItem, fontWeight: sort === s.id ? 700 : 400 }}
                        onClick={() => { setSort(s.id); setSortMenu(false); }}
                      >{s.label}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={S.list}>
              {options == null && <div style={S.empty}>Loading…</div>}
              {options != null && !visible.length && <div style={S.empty}>No matches</div>}
              {visible.length > 0 && (
                <Row onClick={toggleAll}><Check state={allState} /><span>All</span></Row>
              )}
              {visible.map((v) => (
                <Row key={keyOf(v)} onClick={() => toggle(v)}>
                  <Check state={selectedKeys.has(keyOf(v)) ? 'on' : 'off'} />
                  <span style={v == null ? S.nullText : S.text} title={textOf(v)}>{textOf(v)}</span>
                </Row>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ onClick, children }) {
  const [hot, setHot] = useState(false);
  return (
    <div
      role="checkbox"
      style={{ ...S.row, background: hot ? T.hover : 'transparent' }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onClick={onClick}
    >{children}</div>
  );
}

// Sizes are the native control's: 32px field, 32px search row, 26px rows, 14px
// type. The root is height:100% and the open panel flexes into whatever room
// the author gave the element, scrolling inside -- never an iframe scrollbar.
const S = {
  wrap: { height: '100%', display: 'flex', flexDirection: 'column', padding: 8, gap: 8,
          fontFamily: FONT, fontSize: 14, color: T.ink },
  top: { flex: '0 0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, fontWeight: 700, color: T.ink, lineHeight: '18px' },
  badge: { fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
           padding: '2px 6px', borderRadius: 3, background: T.warnTint, color: T.warn },
  box: { flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column',
         border: `1px solid ${T.hairline}`, borderRadius: 4, background: T.field, overflow: 'hidden' },
  header: { flex: '0 0 auto', height: 32, display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 10px', cursor: 'pointer', outline: 'none', userSelect: 'none' },
  headerText: { flex: 1, minWidth: 0, minHeight: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  count: { flex: '0 0 auto', fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
           background: T.accentTint, color: T.accent, fontVariantNumeric: 'tabular-nums' },
  clear: { flex: '0 0 auto', fontSize: 18, lineHeight: '18px', color: T.placeholder, padding: '0 2px' },
  chev: { flex: '0 0 auto', display: 'flex', alignItems: 'center' },
  searchRow: { flex: '0 0 auto', height: 32, display: 'flex', alignItems: 'center', gap: 6,
               padding: '0 10px', borderTop: `1px solid ${T.hairline}`,
               borderBottom: `1px solid ${T.hairline}` },
  searchIcon: { flex: '0 0 auto', display: 'flex' },
  search: { flex: 1, minWidth: 0, minHeight: 0, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: FONT, fontSize: 14, color: T.ink },
  sortBtn: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '4px 0 4px 6px' },
  menu: { position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 5, minWidth: 140,
          background: T.field, border: `1px solid ${T.hairline}`, borderRadius: 4,
          boxShadow: '0 4px 12px rgba(0,0,0,.12)', padding: '4px 0' },
  menuItem: { padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' },
  list: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '2px 0' },
  row: { height: 26, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px',
         cursor: 'pointer', userSelect: 'none' },
  check: { flex: '0 0 auto', width: 16, height: 16, borderRadius: 4, border: '1.5px solid',
           display: 'flex', alignItems: 'center', justifyContent: 'center' },
  text: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  nullText: { fontStyle: 'italic', color: T.placeholder },
  empty: { padding: '8px 10px', color: T.placeholder },
  hint: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', fontSize: 12, color: T.placeholder, padding: '0 24px', lineHeight: 1.6,
          fontFamily: FONT },
};
