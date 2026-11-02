---
name: Autoinstalador desde GitHub
description: Instalador de RED FP360 desde GitHub para un Ubuntu propio.
---

El instalador de Ubuntu debe funcionar sin un servicio externo de documentos: guarda los archivos privados en el disco del servidor y los entrega a través de la API. Replit conserva su almacenamiento administrado.

**Why:** el usuario pidió un destino Ubuntu propio y cuestionó que se añadiera Google como requisito.

**How to apply:** incluye el directorio local de documentos junto con PostgreSQL en el procedimiento de copias de seguridad y recuperación; no pidas credenciales de almacenamiento externo para la instalación Ubuntu.

El instalador y el actualizador deben ser completamente desatendidos: reciben configuración por argumentos o archivos seguros, nunca esperan respuestas en consola y se detienen antes de cambios de datos no revisados.

**Why:** el usuario indicó que el instalador/actualizador debe funcionar sin intervención interactiva.

**How to apply:** exige parámetros faltantes con un error claro; haz explícitas las actualizaciones del sistema y protege las actualizaciones de aplicación con copia previa, comprobación de salud y reversión del código.
