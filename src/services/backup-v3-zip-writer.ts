import { once } from "node:events";
import fs from "node:fs";
import type { Writable } from "node:stream";
import { crc32Buffer } from "./backup-v3-checksums.js";

interface ZipEntryRecord {
  name: string;
  crc32: number;
  size: number;
  offset: number;
}

async function writeAll(output: Writable, chunk: Buffer): Promise<void> {
  if (!output.write(chunk)) {
    await once(output, "drain");
  }
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function localFileHeader(name: string, crc32: number, size: number): Buffer {
  const nameBuffer = Buffer.from(name, "utf8");
  const zip64Extra = Buffer.alloc(20);
  zip64Extra.writeUInt16LE(0x0001, 0);
  zip64Extra.writeUInt16LE(16, 2);
  zip64Extra.writeBigUInt64LE(BigInt(size), 4);
  zip64Extra.writeBigUInt64LE(BigInt(size), 12);
  const header = Buffer.alloc(30 + nameBuffer.length + zip64Extra.length);
  const timestamp = dosDateTime();
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(timestamp.time, 10);
  header.writeUInt16LE(timestamp.date, 12);
  header.writeUInt32LE(crc32, 14);
  header.writeUInt32LE(0xffffffff, 18);
  header.writeUInt32LE(0xffffffff, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(zip64Extra.length, 28);
  nameBuffer.copy(header, 30);
  zip64Extra.copy(header, 30 + nameBuffer.length);
  return header;
}

function centralDirectoryHeader(entry: ZipEntryRecord): Buffer {
  const nameBuffer = Buffer.from(entry.name, "utf8");
  const zip64Extra = Buffer.alloc(28);
  zip64Extra.writeUInt16LE(0x0001, 0);
  zip64Extra.writeUInt16LE(24, 2);
  zip64Extra.writeBigUInt64LE(BigInt(entry.size), 4);
  zip64Extra.writeBigUInt64LE(BigInt(entry.size), 12);
  zip64Extra.writeBigUInt64LE(BigInt(entry.offset), 20);
  const header = Buffer.alloc(46 + nameBuffer.length + zip64Extra.length);
  const timestamp = dosDateTime();
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(timestamp.time, 12);
  header.writeUInt16LE(timestamp.date, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(0xffffffff, 20);
  header.writeUInt32LE(0xffffffff, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(zip64Extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(0xffffffff, 42);
  nameBuffer.copy(header, 46);
  zip64Extra.copy(header, 46 + nameBuffer.length);
  return header;
}

function zip64EndOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const footer = Buffer.alloc(56);
  footer.writeUInt32LE(0x06064b50, 0);
  footer.writeBigUInt64LE(44n, 4);
  footer.writeUInt16LE(45, 12);
  footer.writeUInt16LE(45, 14);
  footer.writeUInt32LE(0, 16);
  footer.writeUInt32LE(0, 20);
  footer.writeBigUInt64LE(BigInt(entryCount), 24);
  footer.writeBigUInt64LE(BigInt(entryCount), 32);
  footer.writeBigUInt64LE(BigInt(centralSize), 40);
  footer.writeBigUInt64LE(BigInt(centralOffset), 48);
  return footer;
}

function zip64EndOfCentralDirectoryLocator(zip64Offset: number): Buffer {
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeUInt32LE(0, 4);
  locator.writeBigUInt64LE(BigInt(zip64Offset), 8);
  locator.writeUInt32LE(1, 16);
  return locator;
}

function endOfCentralDirectory(): Buffer {
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(0xffff, 8);
  footer.writeUInt16LE(0xffff, 10);
  footer.writeUInt32LE(0xffffffff, 12);
  footer.writeUInt32LE(0xffffffff, 16);
  footer.writeUInt16LE(0, 20);
  return footer;
}

export class BackupV3ZipWriter {
  private readonly entries: ZipEntryRecord[] = [];
  private offset = 0;

  constructor(private readonly output: Writable) {}

  async addBuffer(name: string, content: Buffer): Promise<void> {
    const crc32 = (crc32Buffer(content) ^ 0xffffffff) >>> 0;
    await this.writeEntryHeader(name, crc32, content.length);
    await writeAll(this.output, content);
    this.offset += content.length;
  }

  async addFile(name: string, filePath: string, size: number, crc32: number): Promise<void> {
    await this.writeEntryHeader(name, crc32, size);
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk: string | Buffer) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stream.pause();
        void writeAll(this.output, buffer)
          .then(() => stream.resume())
          .catch(reject);
      });
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    this.offset += size;
  }

  async finish(): Promise<void> {
    const centralOffset = this.offset;
    let centralSize = 0;
    for (const entry of this.entries) {
      const header = centralDirectoryHeader(entry);
      await writeAll(this.output, header);
      centralSize += header.length;
    }
    const zip64Offset = this.offset + centralSize;
    await writeAll(this.output, zip64EndOfCentralDirectory(this.entries.length, centralSize, centralOffset));
    await writeAll(this.output, zip64EndOfCentralDirectoryLocator(zip64Offset));
    await writeAll(this.output, endOfCentralDirectory());
  }

  private async writeEntryHeader(name: string, crc32: number, size: number): Promise<void> {
    const header = localFileHeader(name, crc32, size);
    this.entries.push({ name, crc32, size, offset: this.offset });
    await writeAll(this.output, header);
    this.offset += header.length;
  }
}
