# Puente de Piedra (Zaragoza) — Blender. Planta y longitud reales (OpenStreetMap: 225,2 m, eje a 95,2°),
# 7 ojos (luces documentadas entre 14 y 32 m; el reparto concreto es aproximado), tajamares aguas arriba,
# espolones aguas abajo, pretil y farolas según fotografías (Wikimedia Commons, Zarateman CC0 / Moahim CC BY-SA 4.0).
import bpy, bmesh, math
bpy.ops.wm.read_factory_settings(use_empty=True)
CX, CY, ANG = 205.3, 163.3, math.radians(5.2)
def mat(n, c, r=0.85):
    m = bpy.data.materials.new(n); m.use_nodes = True
    b = next(x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED"); b.inputs["Base Color"].default_value = (*c, 1); b.inputs["Roughness"].default_value = r; return m
STONE = mat("BridgeStone", (0.82, 0.70, 0.55)); DECK = mat("BridgeDeck", (0.35, 0.34, 0.33)); IRON = mat("Iron", (0.12, 0.12, 0.13), 0.5)
LAMP = mat("LampGlobe", (1.0, 0.95, 0.85), 0.3); PIL = mat("StoneLight", (0.86, 0.78, 0.66))
G = {}
def W(x, y, z):   # local (x = ancho, y = largo) -> mundo (marco del modelo)
    c, s = math.cos(ANG), math.sin(ANG); return (CX + x * c - y * s, CY + x * s + y * c, z)
def add(name, verts, faces, m):
    me = bpy.data.meshes.new(name); me.from_pydata([W(*v) for v in verts], [], faces); me.update(); me.materials.append(m)
    o = bpy.data.objects.new(name, me); o["grp"] = "Puente"; bpy.context.scene.collection.objects.link(o); return o
def box(name, x0, x1, y0, y1, z0, z1, m):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    return add(name, v, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], m)
L, HW, DECKZ, SPRING = 225.2, 7.0, 13.0, 1.5
spans = [14, 24, 30, 32, 30, 25, 20]      # sur (paseo Echegaray, ojo enterrado) -> norte
pier = (L - sum(spans)) / (len(spans) - 1 + 2)   # pilas intermedias + estribos
y = -L / 2 + pier
openings = []
for s in spans: openings.append((y, y + s)); y += s + pier
# cuerpo: tímpanos (muro macizo) con huecos de arco, como malla por franjas verticales
def solid_with_arches(name, x0, x1):
    bm = bmesh.new(); N = 0
    verts = []; faces = []
    ys = [-L / 2]
    for a, b in openings: ys += [a + (b - a) * k / 24 for k in range(25)]
    ys.append(L / 2); ys = sorted(set(round(v, 3) for v in ys))
    def bottom(yv):
        for a, b in openings:
            if a <= yv <= b:
                r = (b - a) / 2; c = (a + b) / 2; rise = min(r, 11.0)
                return SPRING + rise * math.sqrt(max(0, 1 - ((yv - c) / r) ** 2))
        return -2.0
    for i, yv in enumerate(ys):
        zb = bottom(yv)
        for x in (x0, x1):
            verts += [(x, yv, zb), (x, yv, DECKZ)]
    n = len(ys)
    for i in range(n - 1):
        a = i * 4; b = (i + 1) * 4
        faces += [(a + 0, b + 0, b + 1, a + 1), (a + 2, a + 3, b + 3, b + 2), (a + 0, a + 2, b + 2, b + 0), (a + 1, b + 1, b + 3, a + 3)]
    return add(name, verts, faces, STONE)
solid_with_arches("BridgeBody", -HW, HW)
box("BridgeRoad", -HW + 0.4, HW - 0.4, -L / 2 - 6, L / 2 + 6, DECKZ, DECKZ + 0.25, DECK)
for sx in (-1, 1):
    box(f"Parapet{sx}", sx * HW - 0.3, sx * HW + 0.3, -L / 2, L / 2, DECKZ, DECKZ + 1.1, STONE)
    box(f"Cornice{sx}", sx * HW - 0.45, sx * HW + 0.45, -L / 2, L / 2, DECKZ - 0.6, DECKZ - 0.2, STONE)
# pilas: tajamar triangular aguas arriba (oeste, -x) y espolón redondeado aguas abajo (+x)
for k in range(len(openings) - 1):
    yc = (openings[k][1] + openings[k + 1][0]) / 2; hw = pier / 2 + 0.6
    top = DECKZ - 1.2
    add(f"Tajamar{k}", [(-HW, yc - hw, -1), (-HW, yc + hw, -1), (-HW - 4.6, yc, -1), (-HW, yc - hw, top), (-HW, yc + hw, top), (-HW - 4.6, yc, top), (-HW + 0.3, yc, top + 2.2)],
        [(0, 2, 1), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5), (3, 4, 6), (4, 5, 6), (5, 3, 6)], STONE)
    ring = [(HW + hw * math.sin(t), yc + hw * math.cos(t)) for t in [i * math.pi / 12 for i in range(13)]]
    vs = [(x, yy, -1) for x, yy in ring] + [(x, yy, DECKZ - 0.6) for x, yy in ring]; m = len(ring)
    fs = [(i, i + 1, m + i + 1, m + i) for i in range(m - 1)] + [tuple(range(m, 2 * m))]
    add(f"Espolon{k}", vs, fs, STONE)
# farolas (poste oscuro + globo), cada ~11 m en ambos pretiles
k = 0
for yy in [-L / 2 + 6 + i * 11.2 for i in range(20)]:
    for sx in (-1, 1):
        box(f"LampPost{k}", sx * HW - 0.12, sx * HW + 0.12, yy - 0.12, yy + 0.12, DECKZ + 1.1, DECKZ + 5.2, IRON)
        r = 0.32; zc = DECKZ + 5.55
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=r)
        me = bpy.data.meshes.new(f"Globe{k}"); bm.to_mesh(me); bm.free()
        for v in me.vertices: v.co = (W(sx * HW + v.co.x, yy + v.co.y, zc + v.co.z))
        me.materials.append(LAMP); o = bpy.data.objects.new(f"Globe{k}", me); o["grp"] = "Puente"; bpy.context.scene.collection.objects.link(o); k += 1
# pilares de los leones (dos en cada extremo; fuste de piedra clara, capitel ensanchado)
for ye in (-L / 2 - 4, L / 2 + 4):
    for sx in (-1, 1):
        x = sx * (HW + 1.2)
        add(f"LionPillar{ye>0}{sx}", [(x - 0.9, ye - 0.9, DECKZ), (x + 0.9, ye - 0.9, DECKZ), (x + 0.9, ye + 0.9, DECKZ), (x - 0.9, ye + 0.9, DECKZ),
                                    (x - 0.7, ye - 0.7, DECKZ + 7.2), (x + 0.7, ye - 0.7, DECKZ + 7.2), (x + 0.7, ye + 0.7, DECKZ + 7.2), (x - 0.7, ye + 0.7, DECKZ + 7.2)],
            [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)], PIL)
        box(f"LionCap{ye>0}{sx}", x - 1.15, x + 1.15, ye - 1.15, ye + 1.15, DECKZ + 7.2, DECKZ + 7.9, PIL)
print("SPANS", spans, "PIER", round(pier, 2), "OPENINGS", [(round(a, 1), round(b, 1)) for a, b in openings])
LION_TOPS = [W(sx * (HW + 1.2), ye, DECKZ + 7.9) for ye in (-L / 2 - 4, L / 2 + 4) for sx in (-1, 1)]
print("LIONS", [tuple(round(c, 2) for c in p) for p in LION_TOPS])
bpy.ops.export_scene.gltf(filepath="/home/skyllion/PilarDoc/v5/puente_raw.glb", export_format="GLB", export_apply=True, export_yup=True, export_extras=True)
