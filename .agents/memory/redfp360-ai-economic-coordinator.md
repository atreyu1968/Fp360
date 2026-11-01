---
name: Coordinación económica con IA
description: Requisito de producto para escenarios de empresa y coordinación económica interconectada.
---

La aplicación debe incluir una función basada en IA que establezca las distintas situaciones que deben implementar las empresas participantes y coordine todo el sistema económico interconectado.

La configuración admite un endpoint local o de red privada compatible, sin guardar claves API ni enviar el contexto a proveedores externos.

Los cambios en operaciones simuladas requieren aprobación explícita; la IA coordina, pero no actúa automáticamente.

La API y el modelo de IA se configuran en el panel del administrador; debe contemplarse el uso de una IA local.

Antes de cada propuesta, la IA debe conocer la situación actual de todas las empresas participantes mediante un resumen actualizado de sus indicadores operativos y económicos simulados, sin datos personales.

También debe considerar el historial de todas las operaciones económicas registradas en la red, no solo el estado actual.

**Why:** el usuario pidió que se recuerde e implemente esta capacidad.

**How to apply:** al desarrollar la IA de RED FP360, comprobar que coordina situaciones implementadas por distintas empresas y su sistema económico interconectado, permite configurar la API desde el panel del administrador, contempla una IA local, consulta el estado y el historial de operaciones de toda la red antes de generar cada propuesta y solicita aprobación antes de efectuar cambios simulados.
