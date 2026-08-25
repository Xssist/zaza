import struct

def mp4_duration(path):
    # Walk top-level atoms, find 'moov' -> 'mvhd' -> duration in movie timescale
    with open(path, 'rb') as f:
        data = f.read()

    def walk(buf, start, wanted, depth=0):
        if depth > 4:
            return -1
        i = start
        n = len(buf)
        while i + 8 <= n:
            size = struct.unpack('>I', buf[i:i+4])[0]
            typ  = buf[i+4:i+8]
            if size == 1:
                if i + 16 > n:
                    return -1
                size = struct.unpack('>Q', buf[i+8:i+16])[0]
                header_size = 16
            else:
                header_size = 8
            if size == 0:
                size = n - i
            if size < header_size or i + size > n:
                return -1
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
    if off + 1 > len(data):
        return None
    version = data[off]
    if version == 0:
        if off + 20 > len(data):
            return None
        timescale = struct.unpack('>I', data[off+12:off+16])[0]
        duration  = struct.unpack('>I', data[off+16:off+20])[0]
    elif version == 1:
        if off + 32 > len(data):
            return None
        timescale = struct.unpack('>I', data[off+20:off+24])[0]
        duration  = struct.unpack('>Q', data[off+24:off+32])[0]
    else:
        return None
    if not timescale:
        return None
    return duration / timescale

d = mp4_duration('assets/images/background.mp4')
print(('duration_seconds', d) if d is not None else 'could not determine')
