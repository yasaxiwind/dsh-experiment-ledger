/**
 * Minimal ZIP archive reader/writer (store + deflate read support) so a ledger
 * package can be a single portable file without external dependencies.
 *
 * @module dsh-experiment-ledger/zip
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib'

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const UTF8_FLAG = 0x0800
const MAX_ENTRIES = 5000
const MAX_TOTAL = 200 * 1024 * 1024

let crcTable = null
/** @returns {Int32Array} CRC-32 lookup table. */
function table() {
  if (crcTable !== null) return crcTable
  crcTable = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    crcTable[index] = value
  }
  return crcTable
}

/**
 * @param {Buffer} buffer - bytes.
 * @returns {number} CRC-32 (unsigned).
 */
export function crc32(buffer) {
  const lookup = table()
  let crc = 0xffffffff
  for (const byte of buffer) crc = lookup[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** @returns {{time: number, date: number}} DOS timestamp for now. */
function dosTime() {
  const now = new Date()
  return {
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
    date: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
  }
}

/**
 * Build a ZIP archive, deflating text entries when that makes them smaller.
 * @param {Array<{name: string, data: Buffer | string}>} entries - files.
 * @param {{compress?: boolean}} options - set compress=false for stored entries.
 * @returns {Buffer} archive bytes.
 */
export function createZip(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('zip needs at least one entry')
  if (entries.length > MAX_ENTRIES) throw new Error(`zip has too many entries (${entries.length})`)
  const { time, date } = dosTime()
  const pieces = []
  const central = []
  let offset = 0
  let rawTotal = 0
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replaceAll('\\', '/'), 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8')
    rawTotal += data.length
    if (rawTotal > MAX_TOTAL) throw new Error('zip exceeds the 200 MB limit')
    const crc = crc32(data)
    let method = 0
    let compressed = data
    if (options.compress !== false && data.length > 64) {
      const candidate = deflateRawSync(data)
      if (candidate.length < data.length) {
        method = 8
        compressed = candidate
      }
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8_FLAG, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    pieces.push(local, name, compressed)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(UTF8_FLAG, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt16LE(time, 12)
    header.writeUInt16LE(date, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(compressed.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)
    offset += local.length + name.length + compressed.length
  }
  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_SIGNATURE, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...pieces, centralBuffer, end])
}

/**
 * Read a ZIP archive (stored or deflated entries).
 * @param {Buffer} buffer - archive bytes.
 * @returns {Map<string, Buffer>} file name to bytes.
 */
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('not a zip archive')
  let end = -1
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === END_SIGNATURE) {
      end = index
      break
    }
  }
  if (end < 0) throw new Error('zip end record not found')
  const count = buffer.readUInt16LE(end + 10)
  if (count > MAX_ENTRIES) throw new Error(`zip has too many entries (${count})`)
  const centralOffset = buffer.readUInt32LE(end + 16)
  let cursor = centralOffset
  const files = new Map()
  let total = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error('zip central directory is corrupt')
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressed = buffer.readUInt32LE(cursor + 20)
    const size = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & UTF8_FLAG) !== 0 ? 'utf8' : 'latin1')
    cursor += 46 + nameLength + extraLength + commentLength
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`zip entry header is corrupt: ${name}`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(start, start + compressed)
    if (raw.length !== compressed) throw new Error(`zip entry is truncated: ${name}`)
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error(`unsupported zip compression method ${method}: ${name}`)
    if (data.length > MAX_TOTAL) throw new Error('zip entry exceeds the limit')
    total += data.length
    if (total > MAX_TOTAL) throw new Error('zip content exceeds the 200 MB limit')
    files.set(name, data)
  }
  return files
}

/**
 * @param {Buffer} buffer - first bytes.
 * @returns {boolean} whether the buffer starts with a ZIP local header.
 */
export function looksLikeZip(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_SIGNATURE
}
