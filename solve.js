// csv-reader, exactly — a faster drop-in for csv-reader 1.0.0.
//
// Same answers as the reference on every input {text, header} -> {columns, rows, errors}:
// BOM dropped, LF/CRLF record ends, empty lines no records, lone CR outside quotes dropped
// (stray_cr), quoted fields to the next non-doubled quote with "" -> " and CR/CRLF inside -> LF,
// junk after a closing quote appended as-is (quote_junk), an unclosed quote literal with the
// rest re-read unquoted (unterminated_quote), quotes inside unquoted fields literal, fields
// kept as strings, rows padded (short_row) or cut (long_row) to the first record's width.
//
// Speed: unquoted fields (the vast majority) are found with native indexOf jumps for ','
// and the next LF (cached, refreshed lazily), sliced, never scanned a character at a time;
// quoted fields jump quote to quote with indexOf('"'); character loops run only on the rare
// broken paths (stray CR, unterminated quote, junk with a CR, CR/LF inside quotes).

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;
  let line = 1;

  // Next LF / CR / quote at or after pos; Infinity when none left. Refreshed lazily.
  let nextLF = -1;
  let nextCR = -1;
  let nextQ = -1;

  // The record being read: the line it starts on and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field being read, written by the helpers below (avoids one object per field).
  let fValue = '';
  let fEnded = 0; // 0 comma, 1 line break, 2 end
  let fAdded = 0;

  // Unquoted read, character at a time, exactly as the reference: ',' ends the field,
  // LF / CRLF ends the record, a lone CR is dropped (stray_cr). Starts at pos with the
  // given value; `added` counts only the characters kept here.
  function readUnquotedSlow(value) {
    let added = 0;
    while (pos < n) {
      const ch = text.charCodeAt(pos);
      if (ch === 44) {
        pos += 1;
        fValue = value; fEnded = 0; fAdded = added;
        return;
      }
      if (ch === 10) {
        pos += 1;
        line += 1;
        fValue = value; fEnded = 1; fAdded = added;
        return;
      }
      if (ch === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fValue = value; fEnded = 1; fAdded = added;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        continue;
      }
      value += text[pos];
      added += 1;
      pos += 1;
    }
    fValue = value; fEnded = 2; fAdded = added;
  }

  // Unquoted read from pos with the given starting value, fast when no CR sits in the
  // field. `added` counts the characters kept here.
  function readUnquoted(value) {
    if (nextLF < pos) { nextLF = text.indexOf('\n', pos); if (nextLF < 0) nextLF = Infinity; }
    if (nextCR < pos) { nextCR = text.indexOf('\r', pos); if (nextCR < 0) nextCR = Infinity; }
    const c = text.indexOf(',', pos);
    let end;
    let ended;
    if (c !== -1 && c < nextLF) { end = c; ended = 0; }
    else if (nextLF !== Infinity) { end = nextLF; ended = 1; }
    else { end = n; ended = 2; }
    if (nextCR < end) {
      if (nextCR === end - 1 && ended === 1) {
        // CRLF: the CR is the break, not part of the field.
        fValue = value + text.slice(pos, end - 1);
        fAdded = end - 1 - pos;
        pos = end + 1;
        line += 1;
        fEnded = 1;
        return;
      }
      readUnquotedSlow(value);
      return;
    }
    fValue = value + text.slice(pos, end);
    fAdded = end - pos;
    if (ended === 0) pos = end + 1;
    else if (ended === 1) { pos = end + 1; line += 1; }
    else pos = n;
    fEnded = ended;
  }

  // One raw stretch [p, q) inside a quoted field: CRLF and lone CR each read as LF.
  function quotedSegment(p, q) {
    const seg = text.slice(p, q);
    if (seg.indexOf('\r') === -1) {
      const ni = seg.indexOf('\n');
      if (ni === -1) return seg;
      let c = 0;
      let i = ni;
      while (i !== -1) { c += 1; i = seg.indexOf('\n', i + 1); }
      line += c;
      return seg;
    }
    let c = 0;
    for (let i = 0; i < seg.length; i += 1) {
      const ch = seg.charCodeAt(i);
      if (ch === 13) { c += 1; if (seg.charCodeAt(i + 1) === 10) i += 1; }
      else if (ch === 10) c += 1;
    }
    line += c;
    return seg.replace(/\r\n?/g, '\n');
  }

  // A quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1;
    let closed = false;
    let closeAt = -1;
    while (true) {
      const q = text.indexOf('"', p);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        value += quotedSegment(p, q);
        value += '"';
        p = q + 2;
        continue;
      }
      value += quotedSegment(p, q);
      closeAt = q;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, the text after it re-read unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    const a = closeAt + 1;
    if (a >= n) {
      pos = n;
      fValue = value; fEnded = 2; fAdded = 0;
      return;
    }
    const ch = text.charCodeAt(a);
    if (ch === 44) {
      pos = a + 1;
      fValue = value; fEnded = 0; fAdded = 0;
      return;
    }
    if (ch === 10) {
      pos = a + 1;
      line += 1;
      fValue = value; fEnded = 1; fAdded = 0;
      return;
    }
    if (ch === 13 && text.charCodeAt(a + 1) === 10) {
      pos = a + 2;
      line += 1;
      fValue = value; fEnded = 1; fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands.
    pos = a;
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const ch = text.charCodeAt(pos);
      if (ch === 10) {
        pos += 1;
        line += 1;
      } else if (ch === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast record: no quote and no stray CR on this line — slice it and split at once.
    if (nextLF < pos) { nextLF = text.indexOf('\n', pos); if (nextLF < 0) nextLF = Infinity; }
    if (nextQ < pos) { nextQ = text.indexOf('"', pos); if (nextQ < 0) nextQ = Infinity; }
    const le = nextLF;
    if (nextQ >= le) {
      if (nextCR < pos) { nextCR = text.indexOf('\r', pos); if (nextCR < 0) nextCR = Infinity; }
      const crlf = le !== Infinity && nextCR === le - 1;
      if (nextCR >= le || crlf) {
        const fields = text.slice(pos, crlf ? le - 1 : le).split(',');
        pos = le === Infinity ? n : le + 1;
        if (le !== Infinity) line += 1;
        if (fields.length === 1 && fields[0] === '') continue;
        if (width < 0) width = fields.length;
        if (header && columns === null) {
          columns = fields;
          continue;
        }
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
          fields.length = width;
        }
        rows.push(fields);
        continue;
      }
    }

    const fields = [];
    let ended;
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        // Unquoted field, inlined: the next ',' or LF ends it, a CR before that ends
        // it only as CRLF, otherwise the slow character loop takes it.
        if (nextLF < pos) { nextLF = text.indexOf('\n', pos); if (nextLF < 0) nextLF = Infinity; }
        if (nextCR < pos) { nextCR = text.indexOf('\r', pos); if (nextCR < 0) nextCR = Infinity; }
        const c = text.indexOf(',', pos);
        let end;
        let e;
        if (c !== -1 && c < nextLF) { end = c; e = 0; }
        else if (nextLF !== Infinity) { end = nextLF; e = 1; }
        else { end = n; e = 2; }
        if (nextCR < end) {
          if (nextCR === end - 1 && e === 1) {
            fValue = text.slice(pos, end - 1);
            pos = end + 1;
            line += 1;
            fEnded = 1;
          } else {
            readUnquotedSlow('');
          }
        } else {
          fValue = text.slice(pos, end);
          if (e === 0) pos = end + 1;
          else if (e === 1) { pos = end + 1; line += 1; }
          else pos = n;
          fEnded = e;
        }
      }
      fields.push(fValue);
      ended = fEnded;
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
