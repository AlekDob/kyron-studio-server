// Unzip minimo: STORE (0) e DEFLATE (8). Niente zip64.
import { inflateRawSync } from "node:zlib";
import { isImageName } from "./danea-sku.js";

const LOCAL = 0x04034b50;

export interface ZipFile {
  name: string;
  bytes: Buffer;
}

export function unzipImages(buf: Buffer): ZipFile[] {
  const out: ZipFile[] = [];
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== LOCAL) break;
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    let compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    let dataStart = offset + 30 + nameLen + extraLen;
    if (flags & 0x8) {
      // Data descriptor: size non e' nell'header. Saltiamo questi zip.
      throw new Error("ZIP non supportato (data descriptor). Comprimi di nuovo senza quella opzione, o carica i file uno a uno.");
    }
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith("/") && isImageName(name)) {
      let bytes: Buffer;
      if (method === 0) bytes = Buffer.from(data);
      else if (method === 8) bytes = inflateRawSync(data);
      else throw new Error(`ZIP: compressione ${method} non supportata per ${name}`);
      out.push({ name, bytes });
    }
    offset = dataStart + compSize;
  }
  if (out.length === 0 && buf.readUInt32LE(0) === LOCAL) {
    throw new Error("Nessuna immagine nello ZIP (jpg/png/webp/gif).");
  }
  if (out.length === 0) throw new Error("Non e' uno ZIP valido.");
  return out;
}
