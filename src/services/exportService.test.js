import { describe, it, expect } from 'vitest';
import { exportToCSV, exportToJSON, generateFilename } from './exportService.js';
import { formatDateTime } from '../utils/timeUtils.js';

/**
 * Minimal RFC 4180 parser, so the assertions below test what a spreadsheet
 * would actually read rather than just counting commas.
 * @param {string} text
 * @returns {Array<Array<string>>} Rows of fields
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  row.push(field);
  rows.push(row);
  return rows;
}

/**
 * Pull one titled section out of a parsed export: the header row plus the data
 * rows that follow it, stopping at the blank separator row.
 * @param {Array<Array<string>>} rows
 * @param {string} heading
 * @returns {{header: Array<string>, rows: Array<Array<string>>}}
 */
function section(rows, heading) {
  const start = rows.findIndex(r => r[0] === heading);
  expect(start, `section "${heading}" not found`).toBeGreaterThan(-1);

  const header = rows[start + 1];
  const data = [];

  for (let i = start + 2; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === '') break;
    data.push(row);
  }

  return { header, rows: data };
}

const SECTIONS = [
  '## Session Configuration',
  '## Internal Temperature Readings',
  '## Oven Temperature Events'
];

function makeSession(overrides = {}) {
  return {
    config: {
      units: 'F',
      pullTempF: 125,
      servingTempF: 130,
      carryoverF: 5,
      restMinutes: 20,
      initialOvenTemp: 225,
      createdAt: '2026-08-22T14:31:00.000Z',
      ...overrides.config
    },
    readings: overrides.readings ?? [
      { timestamp: '2026-08-22T14:31:00.000Z', temp: 55, deltaFromStart: null, deltaFromPrevious: null },
      { timestamp: '2026-08-22T15:01:00.000Z', temp: 78.5, deltaFromStart: 23.5, deltaFromPrevious: 23.5 }
    ],
    ovenEvents: overrides.ovenEvents ?? [
      { timestamp: '2026-08-22T14:31:00.000Z', setTemp: 225, previousTemp: null },
      { timestamp: '2026-08-22T15:20:00.000Z', setTemp: 250, previousTemp: 225 }
    ],
    settings: { units: 'F' }
  };
}

describe('exportToCSV field integrity', () => {
  it('keeps a comma-bearing formatted timestamp in a single field', () => {
    // The bug this guards: formatDateTime emits "Aug 22, 2:31 PM".
    expect(formatDateTime('2026-08-22T14:31:00.000Z')).toContain(',');

    const rows = parseCSV(exportToCSV(makeSession()));
    const readings = section(rows, '## Internal Temperature Readings');

    expect(readings.header).toHaveLength(6);
    expect(readings.rows).toHaveLength(2);
    readings.rows.forEach(row => {
      expect(row).toHaveLength(readings.header.length);
    });

    // The formatted time survives intact in its own column
    const timeIndex = readings.header.indexOf('Time');
    expect(readings.rows[0][timeIndex]).toBe(formatDateTime('2026-08-22T14:31:00.000Z'));
  });

  it('round-trips free text containing commas', () => {
    const session = makeSession({
      config: { meatType: 'Beef, grass-fed', meatCut: 'Ribeye, bone-in' }
    });

    const config = section(parseCSV(exportToCSV(session)), '## Session Configuration');
    const values = new Map(config.rows.map(r => [r[0], r[1]]));

    expect(values.get('Meat Type')).toBe('Beef, grass-fed');
    expect(values.get('Cut')).toBe('Ribeye, bone-in');
  });

  it('round-trips a value containing a double quote', () => {
    const session = makeSession({
      config: { notes: 'Used the 3" probe, "deep" placement' }
    });

    const config = section(parseCSV(exportToCSV(session)), '## Session Configuration');
    const notes = config.rows.find(r => r[0] === 'Notes');

    expect(notes).toHaveLength(config.header.length);
    expect(notes[1]).toBe('Used the 3" probe, "deep" placement');
  });

  it('round-trips a value containing newlines', () => {
    const session = makeSession({
      config: { notes: 'Line one\nLine two\r\nLine three' }
    });

    const config = section(parseCSV(exportToCSV(session)), '## Session Configuration');
    const notes = config.rows.find(r => r[0] === 'Notes');

    expect(notes).toHaveLength(config.header.length);
    expect(notes[1]).toBe('Line one\nLine two\r\nLine three');
    // The embedded newline did not create extra rows
    expect(config.rows.filter(r => r[0] === 'Notes')).toHaveLength(1);
  });

  it('renders null and undefined as empty fields, not "null"/"undefined"', () => {
    const session = makeSession({
      readings: [
        { timestamp: '2026-08-22T14:31:00.000Z', temp: 55, deltaFromStart: null, deltaFromPrevious: undefined }
      ],
      ovenEvents: [
        { timestamp: '2026-08-22T14:31:00.000Z', setTemp: 225, previousTemp: null }
      ]
    });

    const rows = parseCSV(exportToCSV(session));
    const readings = section(rows, '## Internal Temperature Readings');
    const events = section(rows, '## Oven Temperature Events');

    expect(readings.rows[0][3]).toBe('');
    expect(readings.rows[0][4]).toBe('');
    expect(events.rows[0][3]).toBe('');
    expect(events.rows[0][4]).toBe('');

    const csv = exportToCSV(session);
    expect(csv).not.toMatch(/(^|,)(null|undefined)(,|$)/m);
  });

  it('gives every section a header and rows of matching width', () => {
    const session = makeSession({
      config: {
        units: 'C',
        meatType: 'Beef, "prime"',
        meatCut: 'Rib\nroast',
        weight: 4.5,
        notes: 'Rested 20m, tented',
        desiredServeTime: '2026-08-22T19:00:00.000Z'
      }
    });

    const rows = parseCSV(exportToCSV(session));

    SECTIONS.forEach(heading => {
      const { header, rows: data } = section(rows, heading);
      expect(header.length, `${heading} header`).toBeGreaterThan(1);
      expect(data.length, `${heading} rows`).toBeGreaterThan(0);
      data.forEach((row, i) => {
        expect(row.length, `${heading} row ${i}`).toBe(header.length);
      });
    });
  });

  it('keeps the metadata preamble to one field per row', () => {
    const rows = parseCSV(exportToCSV(makeSession()));

    expect(rows[0]).toEqual(['# Reverse Sear Tracker - Session Export']);
    expect(rows[1]).toHaveLength(1);
    expect(rows[1][0]).toMatch(/^# Exported: /);
  });

  it('exports an empty session without throwing or shedding headers', () => {
    const session = makeSession({ readings: [], ovenEvents: [] });
    const rows = parseCSV(exportToCSV(session));

    SECTIONS.forEach(heading => {
      const start = rows.findIndex(r => r[0] === heading);
      expect(start, heading).toBeGreaterThan(-1);
    });
    expect(section(rows, '## Internal Temperature Readings').header).toHaveLength(6);
    expect(section(rows, '## Oven Temperature Events').header).toHaveLength(5);
  });
});

describe('exportToJSON', () => {
  it('produces parseable JSON with the session and a summary', () => {
    const parsed = JSON.parse(exportToJSON(makeSession()));

    expect(parsed.session.readings).toHaveLength(2);
    expect(parsed.session.ovenEvents).toHaveLength(2);
    expect(parsed.summary.totalReadings).toBe(2);
    expect(parsed.summary.sessionDurationMinutes).toBe(30);
    expect(parsed.summary.totalTempChange).toBeCloseTo(23.5, 5);
  });

  it('keeps the summary shape stable when there are no readings', () => {
    const populated = JSON.parse(exportToJSON(makeSession())).summary;
    const empty = JSON.parse(exportToJSON(makeSession({ readings: [] }))).summary;

    expect(Object.keys(empty).sort()).toEqual(Object.keys(populated).sort());
    expect(empty.sessionDurationMinutes).toBeNull();
    expect(empty.totalOvenChanges).toBe(2);
  });
});

describe('generateFilename', () => {
  it('appends an ISO date and the extension', () => {
    expect(generateFilename('roast-session', 'csv')).toMatch(/^roast-session-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('carryover is a difference, not a temperature', () => {
  /**
   * The carryover row ran through `csvTemp`, the ABSOLUTE converter, so a
   * 5 °F carryover was exported to a Celsius sheet as `-15.0` - the
   * freezing-point offset applied to a number that has no zero. It sat directly
   * beneath a correctly converted pull/serve pair, so the sheet looked plausible.
   * `csvDelta` already existed fifty lines above for exactly this.
   */
  const rowFor = (label, session) => {
    const rows = parseCSV(exportToCSV(session));
    return rows.find((r) => r[0] === label);
  };

  it('converts as a delta on a Celsius sheet', () => {
    const session = makeSession({ config: { units: 'C', carryoverF: 5 } });
    const [, value, unit] = rowFor('Carryover', session);
    // 5 F of carryover is 2.8 C of carryover, not -15.
    expect(Number(value)).toBeCloseTo(2.8, 1);
    expect(unit).toBe('°C');
  });

  it('leaves a Fahrenheit sheet alone', () => {
    const session = makeSession({ config: { units: 'F', carryoverF: 5 } });
    const [, value] = rowFor('Carryover', session);
    expect(Number(value)).toBeCloseTo(5, 1);
  });

  it('still converts the absolute temperatures beside it as absolutes', () => {
    // The bug was invisible partly because these two were right.
    const session = makeSession({ config: { units: 'C', pullTempF: 121, servingTempF: 125 } });
    expect(Number(rowFor('Pull Temperature', session)[1])).toBeCloseTo(49.4, 1);
    expect(Number(rowFor('Serving Temperature', session)[1])).toBeCloseTo(51.7, 1);
  });
});
