import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { generateFakeQrPngBase64 } from "./fake-qr";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readChunk(buf: Buffer, offset: number): { type: string; data: Buffer; next: number } {
  const length = buf.readUInt32BE(offset);
  const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
  const data = buf.subarray(offset + 8, offset + 8 + length);
  return { type, data, next: offset + 8 + length + 4 };
}

describe("generateFakeQrPngBase64", () => {
  it("produz um PNG bem formado (TASK008-RETEST-PIX-001)", () => {
    const buf = Buffer.from(generateFakeQrPngBase64("fake-1-seed"), "base64");

    expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

    const ihdr = readChunk(buf, 8);
    expect(ihdr.type).toBe("IHDR");
    const width = ihdr.data.readUInt32BE(0);
    const height = ihdr.data.readUInt32BE(4);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(ihdr.data[8]).toBe(8); // bit depth
    expect(ihdr.data[9]).toBe(0); // color type: grayscale

    const idat = readChunk(buf, ihdr.next);
    expect(idat.type).toBe("IDAT");

    // round-trip: os bytes comprimidos precisam inflar de volta para
    // exatamente uma linha de filtro (1 byte) + `width` pixels por linha.
    const raw = inflateSync(idat.data);
    expect(raw.length).toBe(height * (1 + width));

    const iend = readChunk(buf, idat.next);
    expect(iend.type).toBe("IEND");
    expect(iend.next).toBe(buf.length);
  });

  it("é determinístico para o mesmo seed e varia entre seeds diferentes", () => {
    const a = generateFakeQrPngBase64("payment-a");
    const aAgain = generateFakeQrPngBase64("payment-a");
    const b = generateFakeQrPngBase64("payment-b");

    expect(a).toBe(aAgain);
    expect(a).not.toBe(b);
  });
});
