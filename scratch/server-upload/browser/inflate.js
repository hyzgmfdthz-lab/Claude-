/**
 * DEFLATE-Dekomprimierung (RFC 1951) ohne Fremdbibliotheken.
 *
 * Wird von der Einzeldatei-Version benoetigt: Excel-Dateien sind
 * ZIP-Archive mit komprimierten Eintraegen, im Browser steht kein
 * zlib zur Verfuegung.
 */

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/**
 * Kanonischer Huffman-Baum aus Codelaengen.
 * @param {Uint8Array|number[]} lengths
 */
function buildTree(lengths) {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  }
  return { counts, symbols };
}

/**
 * Entpackt einen rohen DEFLATE-Datenstrom.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function inflateRaw(data) {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, data.length * 4));
  let outLen = 0;

  const ensure = (extra) => {
    if (outLen + extra <= out.length) return;
    let size = out.length * 2;
    while (size < outLen + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(out.subarray(0, outLen));
    out = next;
  };

  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= data.length) throw new Error('DEFLATE: Datenstrom unvollständig.');
      bitBuf |= data[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };

  const decode = (tree) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = tree.counts[len];
      if (code - first < count) return tree.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('DEFLATE: ungültiger Huffman-Code.');
  };

  let fixedLit = null;
  let fixedDist = null;
  const getFixed = () => {
    if (!fixedLit) {
      const l = new Uint8Array(288);
      l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
      fixedLit = buildTree(l);
      fixedDist = buildTree(new Uint8Array(30).fill(5));
    }
    return [fixedLit, fixedDist];
  };

  for (;;) {
    const last = bits(1);
    const type = bits(2);

    if (type === 0) {
      // Unkomprimierter Block
      bitBuf = 0;
      bitCnt = 0;
      const len = data[pos] | (data[pos + 1] << 8);
      pos += 4; // LEN + NLEN
      ensure(len);
      out.set(data.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
    } else if (type === 1 || type === 2) {
      let litTree;
      let distTree;
      if (type === 1) {
        [litTree, distTree] = getFixed();
      } else {
        const hlit = bits(5) + 257;
        const hdist = bits(5) + 1;
        const hclen = bits(4) + 4;
        const clen = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = bits(3);
        const clenTree = buildTree(clen);
        const lengths = new Uint8Array(hlit + hdist);
        for (let i = 0; i < lengths.length;) {
          const sym = decode(clenTree);
          if (sym < 16) { lengths[i++] = sym; }
          else if (sym === 16) { const prev = lengths[i - 1]; let r = 3 + bits(2); while (r--) lengths[i++] = prev; }
          else if (sym === 17) { let r = 3 + bits(3); while (r--) lengths[i++] = 0; }
          else { let r = 11 + bits(7); while (r--) lengths[i++] = 0; }
        }
        litTree = buildTree(lengths.subarray(0, hlit));
        distTree = buildTree(lengths.subarray(hlit));
      }

      for (;;) {
        const sym = decode(litTree);
        if (sym === 256) break;
        if (sym < 256) {
          ensure(1);
          out[outLen++] = sym;
        } else {
          const li = sym - 257;
          if (li >= LENGTH_BASE.length) throw new Error('DEFLATE: ungültige Längenangabe.');
          const length = LENGTH_BASE[li] + bits(LENGTH_EXTRA[li]);
          const di = decode(distTree);
          const dist = DIST_BASE[di] + bits(DIST_EXTRA[di]);
          if (dist > outLen) throw new Error('DEFLATE: ungültiger Abstand.');
          ensure(length);
          let from = outLen - dist;
          for (let i = 0; i < length; i++) out[outLen++] = out[from++];
        }
      }
    } else {
      throw new Error('DEFLATE: unbekannter Blocktyp.');
    }

    if (last) break;
  }

  return out.subarray(0, outLen);
}
