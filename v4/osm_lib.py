import json, math
D = json.load(open('/home/skyllion/PilarDoc/v4/osm.json'))['elements']
NODES = {e['id']: (e['lat'], e['lon']) for e in D if e['type'] == 'node'}
WAYS = {e['id']: e for e in D if e['type'] == 'way'}
RELS = [e for e in D if e['type'] == 'relation']
LAT0, LON0 = 41.65646, -0.87878   # referencia (aprox. centro del Pilar)
def xy(lat, lon):
    return ((lon - LON0) * 111320 * math.cos(math.radians(LAT0)), (lat - LAT0) * 110540)
def ring(way_id):
    w = WAYS.get(way_id); return [xy(*NODES[n]) for n in w['nodes'] if n in NODES] if w else []
def join_rings(member_ways):
    segs = [WAYS[m]['nodes'] for m in member_ways if m in WAYS]; rings = []
    while segs:
        cur = list(segs.pop(0))
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[-1]: cur += s[::-1][1:]; segs.pop(i); changed = True; break
        rings.append([xy(*NODES[n]) for n in cur if n in NODES])
    return rings
def area(r): return 0.5 * sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))
