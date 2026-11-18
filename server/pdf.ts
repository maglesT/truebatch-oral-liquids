// PDF copies as the Logbook makes its exports: pdfmake with embedded Noto fonts, A4 landscape, a header on every page
// and a footer with "page X of Y".
import type { FastifyReply } from 'fastify';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { plantClock } from '../shared/plant-time.js';

// Embedded Unicode fonts, so names and symbols print exactly as entered. Characters neither font has are printed as a
// visible code point, never silently changed. From the source (server/) or the build (dist/server/).
const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = [path.resolve(here, 'fonts'), path.resolve(here, '../../server/fonts')].find((d) => existsSync(path.join(d, 'NotoSans-Regular.ttf')))!;
const font = (f: string) => path.join(FONTS, f);
const printer = new PdfPrinter({
  Noto: { normal: font('NotoSans-Regular.ttf'), bold: font('NotoSans-Bold.ttf'), italics: font('NotoSans-Regular.ttf'), bolditalics: font('NotoSans-Bold.ttf') },
  NotoMath: { normal: font('NotoSansMath-Regular.ttf'), bold: font('NotoSansMath-Regular.ttf'), italics: font('NotoSansMath-Regular.ttf'), bolditalics: font('NotoSansMath-Regular.ttf') },
});
const fontkit = createRequire(import.meta.url)('@foliojs-fork/fontkit') as { openSync: (f: string) => { hasGlyphForCodePoint: (c: number) => boolean } };
const mainGlyphs = fontkit.openSync(font('NotoSans-Regular.ttf'));
const mathGlyphs = fontkit.openSync(font('NotoSansMath-Regular.ttf'));

/** Splits text into runs per font; unknown characters become [U+XXXX]. */
export function runs(text: string): { text: string; font?: string }[] {
  const out: { text: string; font?: string }[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const ctrl = cp === 10 || cp === 9;
    const [t, f] = ctrl || mainGlyphs.hasGlyphForCodePoint(cp) ? [ch, undefined] : mathGlyphs.hasGlyphForCodePoint(cp) ? [ch, 'NotoMath'] : [`[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]`, undefined];
    const last = out.at(-1);
    if (last && last.font === f) last.text += t;
    else out.push(f ? { text: t, font: f } : { text: t });
  }
  return out;
}

/** Plant time with the zone label: "15 Nov 2026, 10:21 IST". */
export const plant = (d: Date | string | null | undefined) => (d ? plantClock(d, true) : '');

const DEMO = { text: 'DEMO · ', bold: true, color: '#b3261e' };
/**
 * The page frame of every PDF copy: the title on every page, generated-by footer with page X of Y. A demo
 * installation (server/demo.ts) says DEMO in the header and footer of every page.
 */
export function pageFrame(title: string, by: string, content: Content[], now = new Date(), demo = false): TDocumentDefinitions {
  return {
    pageOrientation: 'landscape',
    pageSize: 'A4',
    pageMargins: [28, 50, 28, 36],
    defaultStyle: { font: 'Noto', fontSize: 9 },
    header: { text: [...(demo ? [DEMO] : []), ...runs(title)], margin: [28, 20, 28, 0], fontSize: 9, bold: true },
    footer: (page, pages) => ({
      text: [...(demo ? [{ ...DEMO, text: 'DEMO installation, not a GMP record · ' }] : []),
        `Generated ${plant(now)} by ${by} · ${demo ? 'copy' : 'true copy'} of the electronic record · page ${page} of ${pages}`],
      margin: [28, 10, 28, 0],
      fontSize: 7,
    }),
    content,
  };
}

export function render(def: TDocumentDefinitions): Promise<Buffer> {
  const doc = printer.createPdfKitDocument(def);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function sendPdf(reply: FastifyReply, name: string, body: Buffer) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${safe}.pdf"`).send(body);
}
