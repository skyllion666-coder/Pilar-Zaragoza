# Reconstrucción 3D de la Basílica del Pilar — Blender (headless)
# blender -b -P build_pilar.py
# Ejes: X = este (aguas abajo del Ebro), Y = norte (río), Z = arriba. Unidades: metros.
# Proporciones: 130 x 67 m de planta, 4 torres en las esquinas, 11 cúpulas (1 mayor + 10 de teja vidriada),
# a partir de fotografías de Wikimedia Commons y datos publicados. Interior esquemático.
import bpy, bmesh, math
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = {}
def mat(name, col, rough=0.8, metal=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    MATS[name] = m; return m

STONE = mat("Stone", (0.78, 0.60, 0.42)); STONE2 = mat("StoneLight", (0.86, 0.72, 0.55))
ROOF = mat("Roof", (0.62, 0.42, 0.28)); LEAD = mat("Lead", (0.45, 0.47, 0.5), 0.5, 0.6)
TILE = mat("Tile", (1, 1, 1), 0.3); GREEN = mat("GreenTile", (0.2, 0.45, 0.35), 0.3)
DARK = mat("Opening", (0.05, 0.04, 0.035)); BRONZE = mat("Bronze", (0.55, 0.36, 0.18), 0.35, 1.0)
GOLD = mat("Gold", (0.9, 0.7, 0.3), 0.3, 1.0); ALAB = mat("Alabaster", (0.92, 0.88, 0.8), 0.6)
FLOOR = mat("Floor", (0.55, 0.5, 0.45), 0.4); PLASTER = mat("Plaster", (0.9, 0.85, 0.75))
WOOD = mat("Wood", (0.3, 0.18, 0.1)); IRON = mat("Iron", (0.25, 0.25, 0.25), 0.6, 0.8)
JASPER = mat("Jasper", (0.6, 0.35, 0.3), 0.3); FRESCO = mat("Fresco", (1, 1, 1))
BRICK = mat("Brick", (0.7, 0.42, 0.28)); SILVER = mat("Silver", (0.85, 0.85, 0.88), 0.25, 1.0)

COLL = {}
def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); COLL[name] = c
    return COLL[name]

def obj_from(name, verts, faces, m, group, uvs=None, smooth=False):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    if uvs is not None:
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = uvs[me.loops[li].vertex_index]
    if smooth:
        for p in me.polygons: p.use_smooth = True
    me.materials.append(m)
    o = bpy.data.objects.new(name, me); o["grp"] = group; coll(group).objects.link(o); return o

BOXES = {}
def box(group, c, s, m, rot=0.0):
    """Acumula cajas por (grupo, material) y las une en un solo mesh al final (menos draw calls)."""
    cx, cy, cz = c; sx, sy, sz = s[0]/2, s[1]/2, s[2]/2
    ca, sa = math.cos(rot), math.sin(rot)
    pts = []
    for z in (-sz, sz):
        for (x, y) in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            pts.append((cx + x*ca - y*sa, cy + x*sa + y*ca, cz + z))
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    BOXES.setdefault((group, m.name), []).append((pts, f))

def flush_boxes():
    for (group, mname), lst in BOXES.items():
        V, F = [], []
        for pts, f in lst:
            o = len(V); V += pts; F += [tuple(i + o for i in ff) for ff in f]
        obj_from(f"{group}__{mname}", V, F, MATS[mname], group)
    BOXES.clear()

def lathe(name, prof, seg, m, group, at=(0, 0, 0), sx=1.0, sy=1.0, smooth=True, cap=False):
    """prof: lista (r, z). Devuelve objeto con UV (u = ángulo, v = índice de perfil)."""
    V, F, UV = [], [], []
    n = len(prof)
    for i in range(seg + 1):
        a = 2*math.pi*i/seg
        for j, (r, z) in enumerate(prof):
            V.append((at[0] + r*math.cos(a)*sx, at[1] + r*math.sin(a)*sy, at[2] + z)); UV.append((i/seg, j/(n-1)))
    for i in range(seg):
        for j in range(n-1):
            a = i*n + j; b = (i+1)*n + j
            F.append((a, b, b+1, a+1))
    return obj_from(name, V, F, m, group, UV, smooth)

def hollow(group, c, s, m, t=0.8):
    """Caja hueca (4 muros) para basamentos que deben dejar ver la cúpula desde dentro."""
    cx, cy, cz = c
    box(group, (cx, cy - s[1]/2 + t/2, cz), (s[0], t, s[2]), m); box(group, (cx, cy + s[1]/2 - t/2, cz), (s[0], t, s[2]), m)
    box(group, (cx - s[0]/2 + t/2, cy, cz), (t, s[1], s[2]), m); box(group, (cx + s[0]/2 - t/2, cy, cz), (t, s[1], s[2]), m)

def prism(group, c, r, h, sides, m, rot=0, caps=True):
    """Prisma regular (para tambores octogonales, linternas)."""
    pts = []; cx, cy, cz = c
    for z in (cz, cz + h):
        for i in range(sides):
            a = 2*math.pi*i/sides + rot; pts.append((cx + r*math.cos(a), cy + r*math.sin(a), z))
    f = [tuple(range(sides))[::-1], tuple(range(sides, 2*sides))] if caps else []
    for i in range(sides):
        j = (i+1) % sides; f.append((i, j, sides + j, sides + i))
    BOXES.setdefault((group, m.name), []).append((pts, f))

# ---------------------------------------------------------------- CUERPO PRINCIPAL
L, W, H = 130.0, 67.0, 24.0
X0, X1, Y0, Y1 = -L/2, L/2, -W/2, W/2
G = "Body"
t = 1.6
# muros (huecos para poder entrar con la cámara por la puerta sur)
box(G, (0, Y1 - t/2, H/2), (L, t, H), STONE)                       # norte
box(G, (X0 + t/2, 0, H/2), (t, W, H), STONE); box(G, (X1 - t/2, 0, H/2), (t, W, H), STONE)
# sur con dos portadas (x = -30, +30)
segs = [(X0, -36), (-24, 24), (36, X1)]
for a, b in segs: box(G, ((a+b)/2, Y0 + t/2, H/2), (b - a, t, H), STONE)
for px in (-30, 30):
    box(G, (px, Y0 + t/2, 19), (12, t, 10), STONE)                     # dintel sobre el arco
    for sx in (-1, 1):
        box(G, (px + sx*7.2, Y0 - 0.6, 11), (2.4, 2.2, 22), STONE2)     # columnas pareadas
        box(G, (px + sx*4.8, Y0 - 0.4, 11), (1.6, 1.6, 22), STONE2)
    box(G, (px, Y0 - 0.6, 23), (18, 2.6, 2), STONE2)                    # entablamento
    # frontón triangular
    pts = [(px - 9, Y0 - 1.2, 24), (px + 9, Y0 - 1.2, 24), (px, Y0 - 1.2, 29), (px - 9, Y0 + 0.5, 24), (px + 9, Y0 + 0.5, 24), (px, Y0 + 0.5, 29)]
    BOXES.setdefault((G, "StoneLight"), []).append((pts, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]))
    box(G, (px, Y0 - 0.05, 10), (8.5, 0.2, 14), DARK)                   # vano de la portada
# pilastras y ventanas en fachadas sur y norte
for yy, sgn in ((Y0, -1), (Y1, 1)):
    for i in range(16):
        x = X0 + 8 + i*7.6
        box(G, (x, yy + sgn*0.4, H/2), (1.4, 0.8, H), STONE2)
        if not any(abs(x - px) < 9 for px in (-30, 30)) or yy == Y1:
            box(G, (x + 3.8, yy + sgn*0.15, 15), (2.2, 0.3, 4.2), DARK)
            box(G, (x + 3.8, yy + sgn*0.15, 7), (1.6, 0.3, 2.6), DARK)
for xx, sgn in ((X0, -1), (X1, 1)):
    for i in range(8):
        y = Y0 + 6 + i*8
        box(G, (xx + sgn*0.4, y, H/2), (0.8, 1.4, H), STONE2)
        box(G, (xx + sgn*0.15, y + 4, 15), (0.3, 2.2, 4.2), DARK)
# cornisa y balaustrada con remates
box(G, (0, Y0 - 0.2, H + 0.4), (L + 1, 2.4, 0.8), STONE2); box(G, (0, Y1 + 0.2, H + 0.4), (L + 1, 2.4, 0.8), STONE2)
box(G, (X0 - 0.2, 0, H + 0.4), (2.4, W + 1, 0.8), STONE2); box(G, (X1 + 0.2, 0, H + 0.4), (2.4, W + 1, 0.8), STONE2)
for yy in (Y0 - 0.2, Y1 + 0.2):
    box(G, (0, yy, H + 1.4), (L, 0.8, 1.2), STONE2)
    for i in range(17):
        x = X0 + 8 + i*7.6
        prism(G, (x, yy, H + 2.0), 0.55, 2.4, 6, STONE2)
# basamento
box(G, (0, 0, 0.4), (L + 2, W + 2, 0.8), STONE2)
# cubiertas: nave central a dos aguas, laterales a un agua (con hueco bajo cúpulas -> se ocultan en interiores)
def gable(group, x0, x1, y0, y1, z0, z1, m):
    yc = (y0 + y1)/2
    pts = [(x0, y0, z0), (x1, y0, z0), (x1, yc, z1), (x0, yc, z1), (x0, y1, z0), (x1, y1, z0)]
    f = [(0, 1, 2, 3), (3, 2, 5, 4), (0, 3, 4), (1, 5, 2)]
    BOXES.setdefault((group, m.name), []).append((pts, f))
gable("Roof", X0, X1, -11, 11, H + 0.6, H + 8, ROOF)
gable("Roof", X0, X1, Y0, -11, H + 0.6, H + 3, ROOF); gable("Roof", X0, X1, 11, Y1, H + 0.6, H + 3, ROOF)
box("Ceiling", (0, 0, H - 1.2), (L - 3, W - 3, 0.6), PLASTER)  # techo interior (se recorta en three.js: ver huecos)

# ---------------------------------------------------------------- CÚPULAS
def dome_tiled(idx, x, y, R, base=H + 1):
    g = f"Dome{idx}"
    hollow(g, (x, y, base + 1.5), (2.3*R, 2.3*R, 3), STONE)                       # basamento cuadrado
    prism(g, (x, y, base + 3), R*1.05, 4.5, 8, STONE, math.pi/8, caps=False)                 # tambor octogonal
    for k in range(8):
        a = 2*math.pi*k/8
        box(g, (x + R*1.02*math.cos(a), y + R*1.02*math.sin(a), base + 5.2), (1.1, 1.1, 1.6), DARK, a)
    prof = [(R*math.cos(math.radians(d)), base + 7.5 + R*1.05*math.sin(math.radians(d))) for d in range(0, 91, 6)]
    lathe(f"DomeTile{idx}", prof, 48, TILE, g, at=(x, y, 0))
    top = base + 7.5 + R*1.05
    prism(g, (x, y, top - 0.3), R*0.28, R*0.45, 8, STONE, math.pi/8)
    lprof = [(R*0.32*math.cos(math.radians(d)), top + R*0.45 + R*0.35*math.sin(math.radians(d))) for d in range(0, 91, 15)]
    lathe(f"DomeLant{idx}", lprof, 16, LEAD, g, at=(x, y, 0))
    lathe(f"DomeSpire{idx}", [(0.35, top + R*0.78), (0.05, top + R*0.78 + R*0.9)], 8, LEAD, g, at=(x, y, 0))
    # interior (para escenas dentro)
    pin = [(R*0.97*math.cos(math.radians(d)), H - 1 + R*1.0*math.sin(math.radians(d)) + 6) for d in range(0, 91, 6)]
    ino = lathe(f"DomeIn{idx}", list(reversed(pin)), 48, FRESCO if idx == "RM" else PLASTER, "Interior", at=(x, y, 0))
    return (x, y, R)

DOMES = []
# cúpula mayor (central): tambor con pilastras, casquete de plomo nervado, linterna
g = "DomeMain"; R = 11.5
hollow(g, (0, 0, H + 3), (26, 26, 6), STONE)
lathe("DomeMainDrum", [(R, H + 6), (R, H + 24)], 16, STONE, g, smooth=False)
for k in range(16):
    a = 2*math.pi*k/16 + math.pi/16
    box(g, (R*1.02*math.cos(a), R*1.02*math.sin(a), H + 15), (1.4, 1.4, 18), STONE2, a)
    if k % 2 == 0:
        a2 = a + math.pi/16
        box(g, (R*1.0*math.cos(a2), R*1.0*math.sin(a2), H + 15), (0.4, 2.2, 7), DARK, a2)
lathe("DomeMainCornice", [(R + 0.2, H + 24), (R + 1.3, H + 24.4), (R + 1.3, H + 25), (R, H + 25.2)], 32, STONE2, g)
prof = [(R*math.cos(math.radians(d)), H + 25 + R*1.15*math.sin(math.radians(d))) for d in range(0, 91, 5)]
lathe("DomeMainCap", prof, 64, LEAD, g)
top = H + 25 + R*1.15
lathe("DomeMainLantern", [(3.2, top - 0.5), (3.2, top + 7), (3.6, top + 7.4), (0.1, top + 11)], 16, STONE, g, smooth=False)
lathe("DomeMainSpire", [(1.2, top + 10.5), (0.9, top + 12), (0.08, top + 17)], 12, LEAD, g)
lathe("DomeMainIn", list(reversed([(R*0.96*math.cos(math.radians(d)), H - 1 + 24 + R*1.1*math.sin(math.radians(d))) for d in range(0, 91, 5)])), 64, PLASTER, "Interior")
lathe("DomeMainInDrum", [(R*0.96, H + 23), (R*0.96, H - 1)], 32, PLASTER, "Interior")
DOMES.append((0, 0, R))
# 10 cúpulas de teja vidriada: 2 sobre el eje y 8 sobre las naves laterales (disposición aproximada)
DOMES.append(dome_tiled("E", 33, 0, 8.0)); DOMES.append(dome_tiled("W", -33, 0, 8.0))
k = 0
for x in (-50, -18, 18, 50):
    for y in (-21, 21):
        name = "RM" if (x, y) == (50, -21) else f"S{k}"
        DOMES.append(dome_tiled(name, x, y, 6.2)); k += 1

# ---------------------------------------------------------------- TORRES
def tower(name, x, y, open_belfry=True):
    g = f"Tower_{name}"
    s = 11.0
    box(g, (x, y, 26), (s, s, 52), STONE)
    for z in (24.4, 40, 52):
        box(g, (x, y, z), (s + 1.2, s + 1.2, 1.0), STONE2)
    for dx in (-1, 1):
        for dy in (-1, 1):
            box(g, (x + dx*(s/2 - 0.4), y + dy*(s/2 - 0.4), 26), (1.4, 1.4, 52), STONE2)
    for sx, sy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        for z in (32, 46):
            box(g, (x + sx*(s/2 + 0.05), y + sy*(s/2 + 0.05), z), (1.4 if sx == 0 else 0.3, 0.3 if sx == 0 else 1.4, 2.6), DARK)
    # cuerpo de campanas (abierto: 4 pilares angulares + arcos)
    s2 = 9.6; zb = 52.5; hb = 13
    for dx in (-1, 1):
        for dy in (-1, 1):
            box(g, (x + dx*(s2/2 - 1.1), y + dy*(s2/2 - 1.1), zb + hb/2), (2.2, 2.2, hb), STONE)
            box(g, (x + dx*(s2/2 + 0.2), y + dy*(s2/2 + 0.2), zb + hb/2), (0.9, 0.9, hb), STONE2)
    for sx, sy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        cx, cy = x + sx*(s2/2 - 0.5), y + sy*(s2/2 - 0.5)
        box(g, (cx, cy, zb + hb - 1.6), (s2 if sx == 0 else 1.0, 1.0 if sx == 0 else s2, 3.2), STONE)
        box(g, (cx, cy, zb + 0.6), (s2 if sx == 0 else 1.0, 1.0 if sx == 0 else s2, 1.2), STONE2)  # antepecho
    box(g, (x, y, zb + 0.1), (s2, s2, 0.4), WOOD)              # suelo de la sala de campanas
    box(g, (x, y, zb + hb + 0.4), (s2 + 1.4, s2 + 1.4, 0.8), STONE2)
    # v2: arcos de medio punto en los vanos del campanario y remates (jarrones/pináculos) en las esquinas
    r = (s2 - 4.4)/2; zs = zb + hb - 3.2 - r
    for sx, sy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        cx, cy = x + sx*(s2/2 - 0.5), y + sy*(s2/2 - 0.5)
        ux, uy = (1, 0) if sx == 0 else (0, 1)          # dirección a lo largo del vano
        nx, ny = (0, sy) if sx == 0 else (sx, 0)         # normal hacia fuera
        for side in (-1, 1):
            V, F = [], []
            pts2 = [(side*r, zs + r)] + [(side*r*math.cos(math.radians(a)), zs + r*math.sin(math.radians(a))) for a in range(0, 91, 10)]
            for off in (-0.5, 0.5):
                for (u, v) in pts2:
                    V.append((cx + ux*u + nx*off, cy + uy*u + ny*off, v))
            n = len(pts2)
            for i in range(1, n - 1):
                F.append((0, i, i + 1)); F.append((n, n + i + 1, n + i))
            BOXES.setdefault((g, "Stone"), []).append((V, F))
        box(g, (cx + nx*0.55, cy + ny*0.55, zs + r + 0.1), (0.9 if sx else 1.2, 1.2 if sx else 0.9, 1.0), STONE2)   # clave
    for dx in (-1, 1):
        for dy in (-1, 1):
            px, py = x + dx*(s2/2 + 0.2), y + dy*(s2/2 + 0.2)
            lathe(f"{g}_urn{dx}{dy}", [(0.55, zb + hb + 0.8), (0.3, zb + hb + 1.2), (0.6, zb + hb + 1.9), (0.45, zb + hb + 2.6), (0.12, zb + hb + 2.9), (0.2, zb + hb + 3.3), (0.0, zb + hb + 3.7)], 10, STONE2, g, at=(px, py, 0))
            qx, qy = x + dx*(s/2 + 0.2), y + dy*(s/2 + 0.2)
            lathe(f"{g}_pin{dx}{dy}", [(0.6, 52.5), (0.45, 53.6), (0.25, 55.5), (0.0, 56.6)], 8, STONE2, g, at=(qx, qy, 0), smooth=False)
    # segundo cuerpo octogonal (con huecos)
    z2 = zb + hb + 0.8
    prism(g, (x, y, z2), 4.4, 9, 8, STONE, math.pi/8)
    for kk in range(8):
        a = 2*math.pi*kk/8
        box(g, (x + 4.3*math.cos(a), y + 4.3*math.sin(a), z2 + 4.5), (0.4, 1.6, 4.6), DARK, a)
        box(g, (x + 4.6*math.cos(a + math.pi/8), y + 4.6*math.sin(a + math.pi/8), z2 + 4.5), (0.9, 0.9, 9), STONE2, a)
    box(g, (x, y, z2 + 9.2), (10, 10, 0.6), STONE2)
    # chapitel: cupulín verde + linterna + aguja
    z3 = z2 + 9.5
    lathe(f"{g}_cap", [(4.6, z3), (4.5, z3 + 1.5), (3.6, z3 + 4.0), (2.0, z3 + 5.6), (1.2, z3 + 6.0)], 16, GREEN, g, at=(x, y, 0))
    prism(g, (x, y, z3 + 5.8), 1.4, 3.2, 8, STONE, math.pi/8)
    lathe(f"{g}_bulb", [(1.6, z3 + 9.0), (1.9, z3 + 10.0), (1.2, z3 + 11.4), (0.4, z3 + 12)], 12, GREEN, g, at=(x, y, 0))
    lathe(f"{g}_spire", [(0.35, z3 + 11.8), (0.04, z3 + 16)], 8, IRON, g, at=(x, y, 0))
    lathe(f"{g}_ball", [(0.0, z3 + 13.2), (0.45, z3 + 13.6), (0.0, z3 + 14.0)], 10, GOLD, g, at=(x, y, 0))
    return (x, y)

TW = {"SW": (X0 + 1, Y0 + 1), "SE": (X1 - 1, Y0 + 1), "NW": (X0 + 1, Y1 - 1), "NE": (X1 - 1, Y1 - 1)}
for k, (x, y) in TW.items(): tower(k, x, y)
# reloj en la torre SE (cuatro esferas en la torre baja de la plaza)
for sx, sy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
    x, y = TW["SE"]
    obj = lathe(f"Clock_{sx}{sy}", [(0, 0), (1.4, 0), (1.6, 0.25)], 24, STONE2, "Tower_SE")
    obj.rotation_euler = (math.pi/2 if sx == 0 else 0, 0 if sx == 0 else math.pi/2, 0)
    if sx == 0: obj.rotation_euler = (-sy*math.pi/2, 0, 0)
    else: obj.rotation_euler = (0, sx*math.pi/2, 0)
    obj.location = (x + sx*5.7, y + sy*5.7, 44)

# ---------------------------------------------------------------- CAMPANAS (diámetros del inventario campaners.com)
def bell(name, D, at, group):
    o = [(0.5, 0), (0.48, 0.04), (0.42, 0.16), (0.35, 0.36), (0.31, 0.56), (0.29, 0.72), (0.26, 0.82), (0.17, 0.88), (0.0, 0.9)]
    prof = [(r*D, z*D) for r, z in o]
    inner = [(max(r*D - 0.05*D, 0), z*D - 0.04*D) for r, z in reversed(o[:-1])]
    b = lathe(name, prof + [(0.0, 0.9*D)][:0] + inner, 40, BRONZE, group)
    for v in b.data.vertices: v.co.z -= 0.9*D  # pivote en la corona (para el volteo)
    b.location = at
    # yugo
    box(group, (at[0], at[1], at[2] + 0.25*D), (0.35*D, 1.25*D, 0.4*D), WOOD)
    return b

# Torre alta de la plaza (SW): 9 campanas (diámetros en m)
SWB = [("Bell_SantaAna", 0.52), ("Bell_Reloj1764", 0.62), ("Bell_Santiaga", 0.73), ("Bell_SantaIsabel", 0.80),
       ("Bell_JuanaPaula", 1.00), ("Bell_Indalecia", 1.30), ("Bell_Braulia", 1.30), ("Bell_PetraPaula", 1.40)]
x, y = TW["SW"]; zb = 52.5
slots = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]
for (n, D), (sx, sy) in zip(SWB, slots):
    bell(n, D, (x + sx*3.2, y + sy*3.2, zb + 1.6 + 0.9*D + 1.2), "Bells_SW")
bell("Bell_Pilara", 1.57, (x, y, zb + 1.2 + 0.9*1.57 + 2.2), "Bells_SW")
box("Bells_SW", (x, y, zb + 1.2 + 0.9*1.57 + 2.7), (0.6, 9.2, 0.5), WOOD)
# Torre baja de la plaza (SE): Sitios (2,20 m), cuartos gótica (1,00 m), carillón de Correos (4)
x, y = TW["SE"]
bell("Bell_Sitios", 2.20, (x, y, zb + 1.0 + 0.9*2.2 + 1.0), "Bells_SE")
box("Bells_SE", (x, y, zb + 1.0 + 0.9*2.2 + 1.5), (0.8, 9.4, 0.7), WOOD)
bell("Bell_Cuartos", 1.00, (x + 3.0, y - 3.0, zb + 9.5), "Bells_SE")
for i, D in enumerate((0.54, 0.70, 0.76, 0.96)):
    bell(f"Bell_Correos{i}", D, (x - 3.2, y - 3.2 + i*2.1, zb + 8.5), "Bells_SE")
box("Bells_SE", (x - 3.2, y, zb + 8.9), (0.4, 8, 0.4), IRON)

# ---------------------------------------------------------------- INTERIOR (esquemático)
G = "Interior"
box(G, (0, 0, 0.85), (L - 3, W - 3, 0.1), FLOOR)
for i in range(9):
    xx = X0 + 13 + i*13
    for yy in (-11, 11):
        if abs(xx) < 2: continue
        box(G, (xx, yy, (H - 1)/2), (2.8, 2.8, H - 1), STONE2)
        box(G, (xx, yy, H - 2.5), (3.6, 3.6, 1.0), STONE2)
# Santa Capilla (Ventura Rodríguez): templete oval con columnas y cupulín
cxp, cyp = 33, 0
for k in range(12):
    a = 2*math.pi*k/12
    px, py = cxp + 7.0*math.cos(a), cyp + 5.2*math.sin(a)
    lathe(f"CapCol{k}", [(0.5, 0.9), (0.45, 9.5), (0.65, 10)], 12, JASPER, "Capilla", at=(px, py, 0))
lathe("CapEntab", [(7.6, 10), (7.6, 11.4), (6.6, 11.4), (6.6, 10)], 48, STONE2, "Capilla", sx=1, sy=5.8/7.6, smooth=False)
lathe("CapDome", [(7.2*math.cos(math.radians(d)), 11.4 + 4.5*math.sin(math.radians(d))) for d in range(0, 91, 10)], 48, STONE2, "Capilla", at=(cxp, cyp, 0), sx=1, sy=0.74)
CAPS = [o for o in COLL["Capilla"].objects if o.name in ("CapEntab",)]
for o in CAPS: o.location = (cxp, cyp, 0)
lathe("CapCrown", [(0.9, 15.9), (0.6, 17.5), (0.05, 18.5)], 12, GOLD, "Capilla", at=(cxp, cyp, 0))
# la columna (pilar) y la imagen: tratamiento simbólico (no se reproduce la talla)
lathe("Pillar", [(0.35, 0.9), (0.35, 2.6)], 16, JASPER, "Capilla", at=(cxp + 2, cyp - 2.5, 0))
lathe("PillarGlow", [(0.2, 2.6), (0.28, 2.9), (0.0, 3.4)], 12, GOLD, "Capilla", at=(cxp + 2, cyp - 2.5, 0))
# retablo mayor de Forment (bloque de alabastro con calles y polsera)
G = "Retablo"; rx, ry = 0, -9
box(G, (rx, ry, 1.6), (16, 2, 1.6), ALAB)
for c in range(5):
    cx = rx - 6.4 + c*3.2
    for r in range(3):
        box(G, (cx, ry + 0.2, 3.6 + r*4), (2.7, 1.2, 3.6), ALAB)
        box(G, (cx, ry - 0.45, 3.6 + r*4), (2.1, 0.1, 2.9), mat("AlabShade", (0.7, 0.66, 0.6)))
box(G, (rx, ry + 0.4, 9), (16.6, 0.6, 15), ALAB)
for c in range(6):
    lathe(f"RetPin{c}", [(0.35, 15.5), (0.05, 19)], 8, ALAB, G, at=(rx - 8 + c*3.2, ry, 0))
# bombas de 1936 junto a la Santa Capilla (tipo Hispana A-6 de 50 kg; forma aproximada)
def bomb(name, at, group, rotx=0):
    prof = [(0.0, 0.0), (0.09, 0.03), (0.16, 0.12), (0.19, 0.3), (0.19, 0.75), (0.15, 0.95), (0.08, 1.12), (0.06, 1.2)]
    b = lathe(name, prof, 20, IRON, group)
    for k in range(4):
        a = math.pi/2*k
        pts = []
        for (r, z) in ((0.06, 1.0), (0.24, 1.2), (0.24, 1.42), (0.06, 1.42)):
            pts.append((r*math.cos(a), r*math.sin(a), z))
        V = pts + [(p[0] + 0.01*math.sin(a), p[1] - 0.01*math.cos(a), p[2]) for p in pts]
        me = b.data
        bm = bmesh.new(); bm.from_mesh(me)
        vs = [bm.verts.new(v) for v in V]
        bm.faces.new(vs[:4]); bm.faces.new(list(reversed(vs[4:])))
        bm.to_mesh(me); bm.free()
    b.location = at; b.rotation_euler = (rotx, 0, 0)
    return b
bomb("Bomb1", (cxp - 7.7, cyp + 6.8, 3.2), "Bombs")
bomb("Bomb2", (cxp - 7.1, cyp + 7.4, 3.2), "Bombs")
bomb("BombFall", (0, 0, 0), "BombsFall")

# ---------------------------------------------------------------- TORRE NUEVA (1504–1892), esquemática
G = "TorreNueva"
tx, ty = -260, -330
prism(G, (tx, ty, 0), 9.5, 12, 16, BRICK, 0)          # basamento (refuerzo octogonal/estrellado: simplificado)
prism(G, (tx, ty, 12), 7.5, 30, 8, BRICK, math.pi/8)
prism(G, (tx, ty, 42), 6.6, 18, 8, BRICK, math.pi/8)
prism(G, (tx, ty, 60), 5.4, 12, 8, BRICK, math.pi/8)
prism(G, (tx, ty, 72), 4.2, 5, 8, BRICK, math.pi/8)
lathe("TN_cap", [(4.4, 77), (0.05, 81)], 8, LEAD, G, at=(tx, ty, 0), smooth=False)

# ---------------------------------------------------------------- TEMPLOS ANTERIORES (solo esquemas)
G = "Romanico"
box(G, (20, 0, 6), (34, 14, 12), STONE2); gable(G, 3, 37, -7, 7, 12, 17, ROOF)
lathe("Rom_apse", [(7, 0), (7, 10), (0.1, 13)], 16, STONE2, G, at=(37, 0, 0), sx=0.7)
box(G, (6, -9, 10), (6, 6, 20), STONE2)
G = "Gotico"
box(G, (15, 0, 9), (62, 30, 18), BRICK); gable(G, -16, 46, -15, 15, 18, 26, ROOF)
for i in range(6):
    box(G, (-12 + i*11, -15.6, 10), (2, 1.4, 18), BRICK)
prism(G, (-18, -18, 0), 4.2, 34, 8, BRICK, math.pi/8)
lathe("Got_cap", [(4.4, 34), (0.05, 40)], 8, ROOF, G, at=(-18, -18, 0), smooth=False)

flush_boxes()
bpy.ops.export_scene.gltf(filepath="/home/skyllion/PilarDoc/v2/pilar_raw.glb", export_format="GLB", export_apply=True,
                          export_yup=True, export_materials="EXPORT", export_extras=True)
print("OBJECTS", len(bpy.data.objects), "TRIS", sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"))
