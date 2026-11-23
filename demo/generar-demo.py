"""Genera demo/chat-demo.zip: un chat de WhatsApp exportado, inventado, con
fotos de recibos sintéticos. Comercios, RUT y personas son ficticios.

Uso: python3 demo/generar-demo.py   (necesita Pillow)

Cada archivo prueba un caso del flujo; las respuestas que daría el lector
están escritas a mano en demo/respuestas/<archivo>.json.
"""

import io
import random
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

AQUI = Path(__file__).parent
random.seed(7)  # mismas imágenes en cada corrida: el zip no cambia sin motivo


def fuente(tam):
    return ImageFont.load_default(size=tam)


def ticket(lineas, ancho=560, borroso=False, rotacion=0.0, fondo=(86, 92, 99)):
    """Dibuja un ticket blanco sobre una mesa gris y lo devuelve como JPEG."""
    alto = 120 + 38 * len(lineas)
    papel = Image.new("RGB", (ancho, alto), (250, 249, 245))
    d = ImageDraw.Draw(papel)
    y = 50
    for texto, estilo in lineas:
        tam = {"titulo": 30, "total": 30, "chico": 18}.get(estilo, 22)
        f = fuente(tam)
        if estilo in ("titulo", "centro"):
            w = d.textlength(texto, font=f)
            d.text(((ancho - w) / 2, y), texto, fill=(25, 25, 25), font=f)
        elif "\t" in texto:
            izq, der = texto.split("\t")
            d.text((40, y), izq, fill=(25, 25, 25), font=f)
            w = d.textlength(der, font=f)
            d.text((ancho - 40 - w, y), der, fill=(25, 25, 25), font=f)
        elif estilo == "linea":
            d.line((40, y + 12, ancho - 40, y + 12), fill=(120, 120, 120), width=2)
        else:
            d.text((40, y), texto, fill=(25, 25, 25), font=f)
        y += 38

    mesa = Image.new("RGB", (ancho + 220, alto + 220), fondo)
    mesa.paste(papel, (110, 110))
    if rotacion:
        mesa = mesa.rotate(rotacion, resample=Image.BICUBIC, fillcolor=fondo)
    if borroso:
        mesa = mesa.filter(ImageFilter.GaussianBlur(4))
    buf = io.BytesIO()
    mesa.save(buf, "JPEG", quality=82)
    return buf.getvalue()


def foto_comida():
    img = Image.new("RGB", (720, 540), (196, 160, 120))
    d = ImageDraw.Draw(img)
    d.ellipse((120, 80, 600, 470), fill=(245, 245, 240))  # plato
    d.ellipse((230, 170, 500, 380), fill=(200, 140, 60))  # milanesa
    for _ in range(40):
        x, y = random.randint(250, 480), random.randint(190, 360)
        d.ellipse((x, y, x + 8, y + 6), fill=(170, 110, 40))
    d.rectangle((470, 330, 560, 380), fill=(240, 210, 80))  # papas
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=82)
    return buf.getvalue()


carniceria = [
    ("CARNICERIA EL NOVILLO", "titulo"),
    ("RUT 219999990011", "centro"),
    ("e-Ticket A 004512", "centro"),
    ("Fecha: 10/11/2026 09:02", ""),
    ("", "linea"),
    ("Carne picada 4 kg\t$ 2.400,00", ""),
    ("Chorizo 1,5 kg\t$ 1.050,00", ""),
    ("", "linea"),
    ("TOTAL\t$ 3.450,00", "total"),
    ("Pago: EFECTIVO", ""),
    ("IVA incluido 10%: $ 313,64", "chico"),
]

archivos = {
    # 1. Compra normal: entra lista.
    "00000003-PHOTO-2026-11-10-09-15-22.jpg": ticket(carniceria),
    # 2. Supermercado con comida y limpieza: se divide en dos categorías.
    "00000004-PHOTO-2026-11-11-18-40-03.jpg": ticket(
        [
            ("AUTOSERVICIO DON JULIO", "titulo"),
            ("RUT 219999990022", "centro"),
            ("e-Ticket A 118830", "centro"),
            ("11/11/2026 18:31", ""),
            ("", "linea"),
            ("Queso dambo 2 kg\t$ 890,00", ""),
            ("Pan de molde x3\t$ 420,00", ""),
            ("Detergente 5 L\t$ 310,00", ""),
            ("Servilletas x500\t$ 180,00", ""),
            ("", "linea"),
            ("TOTAL\t$ 1.800,00", "total"),
            ("Tarjeta debito ****4821", ""),
        ]
    ),
    # 3. Factura de un servicio (empresa ficticia).
    "00000006-PHOTO-2026-11-12-10-02-47.jpg": ticket(
        [
            ("ENERGIA DEL ESTE S.A.", "titulo"),
            ("RUT 219999990033", "centro"),
            ("e-Factura B 77120", "centro"),
            ("Emision: 05/11/2026", ""),
            ("Periodo: octubre 2026", ""),
            ("", "linea"),
            ("Consumo 412 kWh\t$ 2.368,85", ""),
            ("IVA 22%\t$ 521,15", ""),
            ("", "linea"),
            ("TOTAL A PAGAR\t$ 2.890,00", "total"),
            ("Pagado por transferencia 12/11", ""),
        ]
    ),
    # 4. Nota de crédito: entra como gasto negativo.
    "00000007-PHOTO-2026-11-13-12-30-10.jpg": ticket(
        [
            ("DISTRIBUIDORA LA COSTA", "titulo"),
            ("RUT 219999990044", "centro"),
            ("e-Nota de Credito A 2207", "centro"),
            ("13/11/2026", ""),
            ("", "linea"),
            ("Devolucion refrescos 1,5 L x12\t$ 600,00", ""),
            ("", "linea"),
            ("TOTAL\t$ 600,00", "total"),
        ]
    ),
    # 5. No es un recibo: se descarta.
    "00000008-PHOTO-2026-11-13-21-05-55.jpg": foto_comida(),
    # 6. Foto borrosa, sin fecha legible: a revisión.
    "00000009-PHOTO-2026-11-14-16-20-31.jpg": ticket(
        [
            ("FERRETERIA EL TORNILLO", "titulo"),
            ("Rep. canilla y flexibles", ""),
            ("", "linea"),
            ("TOTAL\t$ 1.250,00", "total"),
        ],
        borroso=True,
    ),
    # 7. La misma compra de la carnicería, sacada otra vez por el socio:
    #    archivo distinto, mismo monto y comercio → posible duplicado.
    "00000010-PHOTO-2026-11-15-08-12-40.jpg": ticket(carniceria, rotacion=4, fondo=(120, 98, 80)),
}
# 8. Reenvío de la factura de luz: bytes idénticos → copia exacta, no se lee.
archivos["00000012-PHOTO-2026-11-16-11-00-00.jpg"] = archivos["00000006-PHOTO-2026-11-12-10-02-47.jpg"]
# 9. Foto en HEIC (formato del iPhone que la API no acepta): sale como error claro.
archivos["00000013-PHOTO-2026-11-16-19-45-12.heic"] = b"\x00\x00\x00\x18ftypheic" + bytes(64)

M = "‎"  # marca invisible que WhatsApp de iPhone pone antes de los adjuntos
chat = f"""[9/11/26, 20:11:04] Ana: Armé este grupo para pasar los tickets
[9/11/26, 20:11:30] Bruno: Dale
[10/11/26, 09:15:22] Ana: {M}<adjunto: 00000003-PHOTO-2026-11-10-09-15-22.jpg>
[10/11/26, 09:15:40] Ana: carne de la semana
[11/11/26, 18:40:03] Bruno: {M}<adjunto: 00000004-PHOTO-2026-11-11-18-40-03.jpg>
[12/11/26, 10:02:47] Ana: luz {M}<adjunto: 00000006-PHOTO-2026-11-12-10-02-47.jpg>
[13/11/26, 12:30:10] Bruno: {M}<adjunto: 00000007-PHOTO-2026-11-13-12-30-10.jpg>
[13/11/26, 12:30:31] Bruno: devolución de los refrescos que vinieron golpeados
[13/11/26, 21:05:55] Bruno: {M}<adjunto: 00000008-PHOTO-2026-11-13-21-05-55.jpg>
[13/11/26, 21:06:10] Bruno: miren cómo quedó la milanesa
[14/11/26, 16:20:31] Ana: {M}<adjunto: 00000009-PHOTO-2026-11-14-16-20-31.jpg>
[14/11/26, 16:21:02] Ana: arreglo de la canilla, perdón la foto
[15/11/26, 08:12:40] Bruno: {M}<adjunto: 00000010-PHOTO-2026-11-15-08-12-40.jpg>
[15/11/26, 08:13:00] Bruno: esta ya la pasaste?
[16/11/26, 11:00:00] Ana: {M}<adjunto: 00000012-PHOTO-2026-11-16-11-00-00.jpg>
[16/11/26, 19:45:12] Bruno: {M}<adjunto: 00000013-PHOTO-2026-11-16-19-45-12.heic>
"""

destino = AQUI / "chat-demo.zip"
with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as z:
    # Fecha fija en cada entrada para que el zip sea idéntico entre corridas.
    def poner(nombre, datos):
        z.writestr(zipfile.ZipInfo(nombre, date_time=(2026, 11, 16, 20, 0, 0)), datos)

    poner("_chat.txt", chat.encode("utf-8"))
    for nombre, datos in archivos.items():
        poner(nombre, datos)

print(f"{destino} ({destino.stat().st_size // 1024} KB, {len(archivos)} adjuntos)")
