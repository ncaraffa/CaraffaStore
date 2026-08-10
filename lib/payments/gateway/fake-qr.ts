import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

/**
 * Tabela CRC-32 padrão do PNG (polinômio 0xEDB88320) — calculada uma vez,
 * mesmo algoritmo usado por qualquer encoder PNG.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const MODULES = 25;
const CELL_PX = 8;

/**
 * PNG grayscale determinístico (padrão de módulos derivado de um hash do
 * `seed`) — não é um QR decodificável de verdade, só uma imagem PNG
 * válida para a tela de pagamento local não quebrar
 * (TASK008-RETEST-PIX-001: o base64 anterior era texto, não bytes PNG,
 * então `naturalWidth/naturalHeight` ficavam 0 e o navegador mostrava
 * ícone de imagem quebrada). O FakePixGateway nunca deveria fingir ser
 * escaneável — o conteúdo continua fake, só a imagem passa a ser válida.
 * Zero dependência nova: `node:crypto` e `node:zlib` já são módulos
 * nativos do Node, usados no mesmo espírito de
 * lib/payments/crypto.ts/webhook-signature.ts.
 */
export function generateFakeQrPngBase64(seed: string): string {
  const size = MODULES * CELL_PX;
  const hash = createHash("sha256").update(seed).digest();

  const isDark = (moduleX: number, moduleY: number): boolean => {
    const index = moduleY * MODULES + moduleX;
    const byte = hash[index % hash.length]!;
    const shift = index % 8;
    return ((byte >> shift) & 1) === 1;
  };

  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size);
    row[0] = 0; // filter type: none
    const moduleY = Math.floor(y / CELL_PX);
    for (let x = 0; x < size; x++) {
      const moduleX = Math.floor(x / CELL_PX);
      row[1 + x] = isDark(moduleX, moduleY) ? 0x00 : 0xff;
    }
    rows.push(row);
  }
  const rawScanlines = Buffer.concat(rows);
  const idatData = deflateSync(rawScanlines);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 0; // color type: grayscale
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  const png = Buffer.concat([
    signature,
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  return png.toString("base64");
}
