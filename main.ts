// Entry for make.fun bounty "Build a tiny stack virtual machine" (tiny-stack-vm-01-run-20261122).
// Faithful implementation of make.fun's tiny stack ISA v1 (generator/subject/ISA.md in the kit);
// the reference VM is generator/subject/vm.mjs — every check below follows its order:
// steps -> pc -> opcode -> immediate -> underflow -> overflow -> the instruction's own traps.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per-opcode immediate byte count (-1 = not an opcode), pops and pushes.
const IMM = new Int8Array(256).fill(-1);
const POPN = new Int8Array(256);
const PUSHN = new Int8Array(256);
for (const [b, im, po, pu] of [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1],
  [0x20, 0, 2, 1], [0x21, 0, 2, 1], [0x22, 0, 2, 1],
  [0x30, 2, 0, 0], [0x31, 2, 1, 0], [0x32, 2, 1, 0],
  [0x33, 2, 0, 0], [0x34, 0, 0, 0],
  [0x40, 0, 1, 1], [0x41, 0, 2, 0],
  [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1], [0x53, 0, 1, 0],
]) {
  IMM[b] = im; POPN[b] = po; PUSHN[b] = pu;
}

// run(program, input) => [outputBytes, outputLength, exitCode]
function run(p: Uint8Array, inp: Uint8Array): [Uint8Array, number, number] {
  const n = p.length;
  const D = new Int32Array(256);   // data stack
  const C = new Int32Array(64);    // call stack (return addresses)
  const M = new Int32Array(256);   // memory
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, olen = 0, ip = 0, pc = 0, steps = 0;
  for (;;) {
    if (steps === 1000000) return [out, olen, 10];      // step limit
    if (pc < 0 || pc >= n) return [out, olen, 9];       // pc outside the program
    const op = p[pc];
    const im = IMM[op];
    if (im < 0) return [out, olen, 5];                  // unknown opcode
    const nx = pc + 1 + im;
    if (pc + im >= n) return [out, olen, 9];            // immediate cut off
    steps++;
    const po = POPN[op], pu = PUSHN[op];
    if (sp < po) return [out, olen, 2];                 // stack underflow
    if (sp - po + pu > 256) return [out, olen, 3];      // stack overflow
    const o = pc;                                       // address of the opcode byte
    pc = nx;
    switch (op) {
      case 0x00: return [out, olen, 0];                 // HALT
      case 0x01: D[sp++] = (p[o + 1] << 24) >> 24; break; // PUSH8 sign-extended
      case 0x02: D[sp++] = p[o + 1] | (p[o + 2] << 8) | (p[o + 3] << 16) | (p[o + 4] << 24); break;
      case 0x03: sp--; break;                           // POP
      case 0x04: D[sp] = D[sp - 1]; sp++; break;        // DUP
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;        // OVER
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x10: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = (a + b) | 0; sp--; break; }
      case 0x11: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = (a - b) | 0; sp--; break; }
      case 0x12: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = Math.imul(a, b); sp--; break; }
      case 0x13: { const b = D[sp - 1], a = D[sp - 2];                    // DIV
        if (b === 0) return [out, olen, 4];
        D[sp - 2] = (a === -2147483648 && b === -1) ? a : (a / b) | 0; sp--; break; }
      case 0x14: { const b = D[sp - 1], a = D[sp - 2];                    // MOD
        if (b === 0) return [out, olen, 4];
        D[sp - 2] = b === -1 ? 0 : (a % b) | 0; sp--; break; }
      case 0x15: { const b = D[sp - 1], a = D[sp - 2];                    // DIVU
        if (b === 0) return [out, olen, 4];
        D[sp - 2] = Math.floor((a >>> 0) / (b >>> 0)) | 0; sp--; break; }
      case 0x16: { const b = D[sp - 1], a = D[sp - 2];                    // MODU
        if (b === 0) return [out, olen, 4];
        D[sp - 2] = ((a >>> 0) % (b >>> 0)) | 0; sp--; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;     // NEG
      case 0x18: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = a & b; sp--; break; }
      case 0x19: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = a | b; sp--; break; }
      case 0x1a: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = a ^ b; sp--; break; }
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;         // NOT
      case 0x1c: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = a << (b & 31); sp--; break; }
      case 0x1d: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = a >> (b & 31); sp--; break; }
      case 0x1e: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = (a >>> (b & 31)) | 0; sp--; break; }
      case 0x20: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = a === b ? 1 : 0; sp--; break; }
      case 0x21: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = a < b ? 1 : 0; sp--; break; }
      case 0x22: { const b = D[sp - 1], a = D[sp - 2]; D[sp - 2] = (a >>> 0) < (b >>> 0) ? 1 : 0; sp--; break; }
      case 0x30: case 0x31: case 0x32: {                // JMP / JZ / JNZ
        const rel = ((p[o + 1] | (p[o + 2] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = D[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:                                        // CALL
        if (csp === 64) return [out, olen, 7];
        C[csp++] = nx;
        pc = p[o + 1] | (p[o + 2] << 8);
        break;
      case 0x34:                                        // RET
        if (csp === 0) return [out, olen, 8];
        pc = C[--csp];
        break;
      case 0x40: { const a = D[sp - 1];                 // LOAD
        if (a < 0 || a > 255) return [out, olen, 6];
        D[sp - 1] = M[a]; break; }
      case 0x41: { const a = D[sp - 1], v = D[sp - 2];  // STORE
        if (a < 0 || a > 255) return [out, olen, 6];
        sp -= 2; M[a] = v; break; }
      case 0x50: {                                      // PRINT: decimal ASCII, no padding, no newline
        const v = D[--sp];
        const neg = v < 0;
        let u = neg ? -v : v;                           // up to 2147483648, exact as a double
        let d = 1;
        for (let x = u; x >= 10; d++) x = (x / 10) | 0;
        const len = d + (neg ? 1 : 0);
        if (olen + len > 65536) return [out, olen, 11]; // writes none of its bytes
        let i = olen + len;
        do { out[--i] = 48 + (u % 10); u = (u / 10) | 0; } while (u > 0);
        if (neg) out[--i] = 45;
        olen += len;
        break;
      }
      case 0x51:                                        // PUTC
        if (olen === 65536) return [out, olen, 11];
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break; // IN
      case 0x53: return [out, olen, D[--sp] & 255];     // EXIT
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(
    new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))),
  );
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r[0].subarray(0, r[1]));
  writeFileSync(join(O, id, 'exit.txt'), `${r[2]}\n`);
}
