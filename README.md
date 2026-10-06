# El Pilar · Memoria de piedra y bronce

Documental 3D cinematográfico (2:58) sobre la Basílica-Catedral de Nuestra Señora del Pilar de Zaragoza.

**Ver:** descarga uno de los HTML y ábrelo en Chrome o Firefox (archivo único, funciona sin conexión), activa el sonido y pulsa **INICIAR DOCUMENTAL**.

| Versión | Archivo | Novedades |
|---|---|---|
| v1 | `Pilar_3D_Documental.html` | Versión original (2:58), voz Piper |
| v2 | `Pilar_3D_Documental_v2.html` | Texturas reales CC0 (Poly Haven), oclusión ambiental, nubes, arcos y remates en las torres, modelo comprimido |
| **v3** | `Pilar_3D_Documental_v3.html` | **Recomendada (2:52).** Voz XTTS v2 verificada frase a frase con Whisper, Ebro con reflejos, destellos, palomas, gente en la plaza, velas y rótulos nuevos |

## Contenido
- Reconstrucción 3D del Pilar generada con Blender (`build_pilar.py`) a partir de fotografías y documentación publicada.
- Viaje en el tiempo (torres de 1961 y 1907, templo barroco de 1681, esquemas de los templos gótico-mudéjar y románico).
- Interior: Santa Capilla, cúpula *Regina Martyrum* de Goya (fotografía de dominio público proyectada), retablo de Forment.
- Campanas: inventario completo (15 en dos torres + 1 de señales), bandeo de la Pilara, Campana de los Sitios y la Torre Nueva.
- Bombas del 3 de agosto de 1936, con las versiones discrepantes de las fuentes.
- Música y campanas sintetizadas en tiempo real (Web Audio); narración con Piper TTS (voz es_ES davefx).

Las fuentes están listadas en la pantalla final del documental. Todo lo aproximado o esquemático se indica en pantalla.

## Regenerar
```bash
blender -b -P build_pilar.py        # modelo -> build/pilar.glb
python3 tts.py                      # narración (requiere piper-tts y la voz es_ES-davefx-medium en tts/)
python3 mixvo.py                    # pista de voz + build/timeline.json
npm install && python3 bundle.py    # empaqueta Pilar_3D_Documental.html
```
