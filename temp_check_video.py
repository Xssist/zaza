import mmap
import struct

def mp4_duration(path):
    # Read MP4 metadata without copying the whole video into Python memory."
    with open(path, 'rb') as file:
        if not file.seek(0, 2) or file.tell() == 0:
            return None
        file.seek(0)
        with mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as data:
            containers = {b'moov', b'trak', b'mdia', b'minf', b'stbl', b'edts', b'dinf', b'udta'}

            def walk(start, wanted, depth=0):
                if depth > 4:
                    return None
                i, size_limit = start, len(data)
                while i + 8 <= size_limit:
                    size = struct.unpack_from('>I', data, i)[0]
                    typ = data[i + 4:i + 8]
                    header = 8
                    if size == 1:
                        if i + 16 > size_limit:
                            return None
                        size = struct.unpack_from('>Q', data, i + 8)[0]
                        header = 16
                    elif size == 0:
                        size = size_limit - i
                    if size < header or i + size > size_limit:
                        return None
                    if typ == wanted:
                        return i, size
                    if typ in containers:
                        found = walk(i + header, wanted, depth + 1)
                        if found:
                            return found
                    i += size
                return None
            atom = walk(0, b'mvhd')
            if not atom:
                return None
            off = atom[0] + 8
            version = data[off]
            if version == 0 and off + 20 <= len(data):
                timescale, duration = struct.unpack_from('>II', data, off + 12)
            elif version == 1 and off + 32 <= len(data):
                timescale = struct.unpack_from('>I', data, off + 20)[0]
                duration = struct.unpack_from('>Q', data, off + 24)[0]
            else:
                return None
            return duration / timescale if timescale else None

d = mp4_duration('assets/images/background.mp4')
print(('duration_seconds', d) if d is not None else 'could not determine')
