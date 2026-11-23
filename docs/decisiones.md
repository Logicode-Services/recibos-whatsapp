# Decisiones técnicas

Cada decisión con su contexto, lo que se descartó y lo que cuesta. Formato inspirado en los ADR (Architecture Decision Records).

## 1. Exportar el chat en vez de un bot de WhatsApp

**Contexto.** Las fotos ya están en un grupo de WhatsApp. Hay dos formas de sacarlas: un bot con la WhatsApp Cloud API que reciba cada foto al momento, o el export manual del chat ("Exportar chat → Incluir archivos").

**Decisión.** El export.

**Por qué.** La Cloud API exige un número dedicado, verificación de Meta y un servidor siempre prendido para recibir los webhooks, y no puede leer un grupo existente de personas. El export no necesita nada de eso, y para cerrar el mes una vez cada tanto alcanza.

**Costo.** No es en tiempo real y alguien tiene que exportar. Si el negocio necesitara cargar al momento, el lector y las reglas sirven igual: solo cambia la entrada.

## 2. Puertos y adaptadores para el lector

**Contexto.** Leer un recibo con Claude cuesta plata, necesita red y una clave, y no da exactamente la misma respuesta dos veces. Nada de eso sirve para los tests ni para una demo.

**Decisión.** El flujo depende de la interfaz `ReceiptExtractor` (`src/extract/types.ts`). `ClaudeExtractor` es la implementación real. `FixtureExtractor` devuelve respuestas guardadas.

**Alternativa descartada.** Simular el SDK de Anthropic en los tests (mock). Ata los tests a la forma interna del SDK y no sirve para la demo.

**Costo.** Una capa más. Lo que se prueba sin red es todo menos la llamada a la API en sí.

## 3. Salida con esquema JSON, más una normalización propia

**Contexto.** Si el modelo responde en texto libre, hay que interpretarlo y puede venir con otra forma.

**Decisión.** `output_config.format` con un esquema JSON: la API garantiza los campos, los tipos y que la categoría sea una de la lista. El esquema se arma en cada corrida con las categorías configuradas.

**Lo que el esquema no cubre.** Que la fecha exista, que el monto sea positivo, que el RUT no traiga puntos. Eso lo hace `normalizeReceipt` en `src/rules.ts`, que además protege si mañana el lector es otro.

## 4. "Ante la duda, null" y revisión humana

**Contexto.** Un modelo de visión puede leer mal un 7 por un 1, y un gasto equivocado en las finanzas es peor que uno que falta.

**Decisión.** El prompt pide `null` en lo que no se lee con seguridad y una confianza (alta, media o baja). Las reglas (`reviewStatus`) mandan a **Para revisar** cualquier recibo con algo supuesto: sin total, sin fecha, confianza menor a alta, en dólares, posible duplicado o con nota del lector. Al webhook solo van los listos.

**Costo.** Más trabajo manual en fotos malas. Es intencional.

## 5. Idempotencia: hash del contenido y caché

**Contexto.** Lo normal es volver a exportar el chat entero cada mes, con las fotos viejas incluidas.

**Decisión.**
- Cada archivo se identifica por el SHA-256 de sus bytes. Dos archivos iguales en el mismo export se leen una vez.
- La caché en disco usa como clave el hash más el `id` del lector, que incluye el modelo, la versión del prompt y un hash del prompt con las categorías. Si cambia algo de eso, se vuelve a leer.
- Los gastos tienen un `id` estable (el hash, más la categoría si se dividió). El webhook lo manda como `Idempotency-Key`.

**Límite.** El hash no reconoce la misma compra fotografiada dos veces: son archivos distintos. Para eso está la regla de duplicado probable (decisión 7).

## 6. Errores: aislar, reintentar lo pasajero, cortar lo definitivo

- **Por recibo.** Un error de lectura queda como fila con el motivo y la tanda sigue.
- **API de Claude.** El SDK ya reintenta 429, 529 y cortes de red con espera creciente. Se le suben los intentos a 4. Si el filtro de seguridad rechaza una imagen, `fallbacks: "default"` la reintenta con otro modelo dentro de la misma llamada.
- **Webhook.** Reintenta 408, 429, 5xx, timeouts y cortes de red con espera exponencial más un poco de azar (*jitter*), para que varios clientes no reintenten en el mismo instante. Si el servidor manda `Retry-After`, se respeta. Un 4xx corta enseguida: el pedido está mal y repetirlo no lo arregla. Al final se informa qué falló y el programa termina con código 2, para que un script o un cron lo detecte.

## 7. Duplicado probable: monto, fecha y comercio

**Regla.** El mismo monto (con $1 de margen), a 3 días o menos y, si los dos tienen comercio, el mismo comercio sin contar tildes ni mayúsculas. Se compara en el orden del chat, así se marca la segunda foto y no la primera.

**Por qué 3 días.** La foto del ticket suele llegar al grupo uno o dos días después de la compra.

**Costo.** Dos compras iguales el mismo día en el mismo lugar se marcan como posible duplicado. Van a revisión, no se borran.

## 8. Compras mezcladas: dividir solo si cierra

Un ticket de supermercado puede tener comida (proveedores) y limpieza (insumos). Se divide en un gasto por categoría solo si todos los ítems tienen importe y categoría y suman el total impreso con 3 % de margen (descuentos generales). Los montos se reparten en proporción y los centésimos que sobran del redondeo van a la parte más grande, así la suma da exacta. Si no cierra, el gasto queda entero en la categoría principal.

## 9. Concurrencia limitada

`mapLimit` corre como máximo N lecturas a la vez (3 por defecto) y devuelve los resultados en el orden de entrada. Con `Promise.all` sobre 50 fotos saldrían 50 pedidos juntos y la API respondería 429.

## 10. Node 24 sin paso de compilación

Node 24 ejecuta `.ts` directo: le saca los tipos al vuelo. `tsc --noEmit` solo verifica. La contra es que no se puede usar sintaxis que genera código (`enum`, `namespace`, propiedades en el constructor). `erasableSyntaxOnly` en el tsconfig la prohíbe para que el error salte en la verificación y no al correr.

## 11. Planilla con fórmulas

La hoja **Resumen** usa `SUMIFS` sobre **Gastos**, no números fijos. Quien revisa puede pasar una fila de **Para revisar** a **Gastos** y el resumen se actualiza solo. Suma solo pesos: los gastos en dólares van a revisión.
