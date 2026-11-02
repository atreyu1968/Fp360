---
name: Coordinación económica con IA
description: Requisito de producto para escenarios de empresa y coordinación económica interconectada.
---

La aplicación debe incluir una función basada en IA que establezca las distintas situaciones que deben implementar las empresas participantes y coordine todo el sistema económico interconectado.

El endpoint local o privado es la opción predeterminada. GroqCloud es una alternativa externa optativa seleccionada en el panel de administración; su clave vive en Replit Secrets, nunca en el navegador o PostgreSQL. Antes de activar GroqCloud, un administrador debe confirmar el envío del contexto económico simulado de la red. No se deben enviar datos personales.

Por defecto, los cambios en operaciones simuladas requieren aprobación explícita. Un administrador puede habilitar autonomía simulada para una empresa concreta.

El proveedor, endpoint local y modelo se configuran en el panel del administrador; debe contemplarse la IA local y la API de GroqCloud.

Antes de cada propuesta, la IA debe conocer la situación actual de todas las empresas participantes mediante un resumen actualizado de sus indicadores operativos y económicos simulados, sin datos personales.

También debe considerar el historial de todas las operaciones económicas registradas en la red, no solo el estado actual.

**Why:** el usuario pidió coordinación interempresarial, una opción local y GroqCloud como proveedor externo alternativo, además de un modo de autonomía simulada que activa el administrador para cubrir empresas sin participación suficiente.

**How to apply:** al desarrollar la IA de RED FP360, comprobar que coordina situaciones implementadas por distintas empresas y su sistema económico interconectado, configura proveedor y modelo desde el panel, mantiene la IA local como opción predeterminada y solo envía contexto simulado a GroqCloud tras confirmación explícita del administrador. Consulta el estado y el historial de operaciones de toda la red antes de cada propuesta, excluye datos personales y solicita aprobación antes de cambios salvo que el administrador haya habilitado autonomía simulada para esa empresa. La autonomía debe ser explícita, auditable, limitada al simulador y revocable.
