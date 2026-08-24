import struct, sys

def mp4_duration(path):
    # Walk top-level atoms, find 'moov' -> 'mvhd' -> duration in movie timescale
    with open(path, 'rb') as f:
        data = f.read()

    def find_atom(buf, start, wanted):
        i = start
        n = len(buf)
        while i + 8 <= n:
            size = struct.unpack('>I', buf[i:i+4])[0]
            typ  = buf[i+4:i+8]
            if typ == b'moov' and wanted == b'moov':
                return i
            if size == 1:
                size = struct.unpack('>Q', buf[i+8:i+16])[0]
            if size == 0:
                size = n - i
            if typ == wanted:
                return i
            i += size
        return -1

    def walk(buf, start, wanted, depth=0):
        if depth > 4:
            return -1
        i = start
        n = len(buf)
        while i + 8 <= n:
            size = struct.unpack('>I', buf[i:i+4])[0]
            typ  = buf[i+4:i+8]
            if size == 1:
                size = struct.unpack('>Q', buf[i+8:i+16])[0]
            if size == 0:
                size = n - i
            if typ == wanted:
                return (i, size, typ)
            # recurse into container atoms
            if typ in (b'moov', b'trak', b'mdia', b'minf', b'stbl', b'edts', b'dinf', b'udta'):
                r = walk(buf, i + 8, wanted, depth + 1)
                if r != -1 and r[2] == wanted:
                    return r
            i += size
        return -1

    # timescale & duration in mvhd
    r = walk(data, 0, b'mvhd')
    if r == -1 or len(r) < 3:
        return None
    off = r[0] + 8
    version = data[off]
    if version == 0:
        timescale = struct.unpack('>I', data[off+12:off+16])[0]
        duration  = struct.unpack('>I', data[off+16:off+20])[0]
    else:
        timescale = struct.unpack('>I', data[off+20:off+24])[0]
        duration  = struct.unpack('>Q', data[off+24:off+32])[0]
    if not timescale:
        return None
    return duration / timescale

d = mp4_duration('assets/images/background.mp4')
print(('duration_seconds', d) if d is not None else 'could not determine')
