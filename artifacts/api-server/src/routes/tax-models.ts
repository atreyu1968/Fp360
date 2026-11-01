export type TaxAgency = "aeat" | "atc";
export type TaxType =
  | "igic"
  | "withholding"
  | "census_canary"
  | "census_state"
  | "personal_income"
  | "corporate_tax"
  | "informative_canary"
  | "informative_state";
export type TaxEntityType = "autonomo" | "sociedad";
export type IgicRegime = "general" | "simplified";
export type IncomeTaxMethod = "direct" | "objective" | "not_applicable";
export type TaxPeriodicity = "quarterly" | "annual" | "census";

export type TaxProfile = {
  organizationId: string;
  entityType: TaxEntityType;
  igicRegime: IgicRegime;
  incomeTaxMethod: IncomeTaxMethod;
  hasEmployees: boolean;
  withholdsProfessionals: boolean;
  paysBusinessRent: boolean;
  updatedByName: string;
  updatedAt: Date;
};

export type TaxFormField = {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "select" | "checkbox";
  required: boolean;
  options?: string[];
  note?: string;
};

type TaxModelDefinition = {
  modelCode: string;
  taxType: TaxType;
  agency: TaxAgency;
  label: string;
  periodicity: TaxPeriodicity;
  officialUrl: string;
  referenceVersion: string;
  formFields: TaxFormField[];
};

const referenceVersion = "Última versión pública consultada a 01/11/2026; ejercicio 2027 aún no publicado";
const atcIndex = "https://sede.gobiernodecanarias.org/tributos/jsf/publico/sede/tramites/tramite.jsp?categoria=igic";
const aeat036 = "https://sede.agenciatributaria.gob.es/Sede/censos-nif-domicilio-fiscal/censos/modelos-036-037_____icacion-baja-declaracion-simplificada_/modelo-036.html";
const input = (key: string, label: string, kind: TaxFormField["kind"] = "text", required = false, note?: string, options?: string[]): TaxFormField => ({
  key, label, kind, required, ...(note ? { note } : {}), ...(options ? { options } : {}),
});

export const TAX_MODEL_CATALOG: TaxModelDefinition[] = [
  {
    modelCode: "400", taxType: "census_canary", agency: "atc", label: "Declaración censal IGIC · alta, modificación o cese",
    periodicity: "census", officialUrl: atcIndex, referenceVersion,
    formFields: [
      input("censusAction", "Causa de presentación", "select", true, undefined, ["Alta", "Modificación", "Cese"]),
      input("taxId", "NIF de la persona o entidad", "text", true),
      input("legalName", "Nombre o razón social", "text", true),
      input("effectiveDate", "Fecha de efecto", "date", true),
      input("economicActivity", "Actividad económica", "text", true),
      input("mainAddress", "Domicilio de actividad", "text"),
      input("igicRegime", "Régimen IGIC", "select", true, undefined, ["General", "Simplificado"]),
    ],
  },
  {
    modelCode: "415", taxType: "informative_canary", agency: "atc", label: "Declaración anual de operaciones con terceras personas",
    periodicity: "annual", officialUrl: "https://sede.gobiernodecanarias.org/sede/tramites/4010", referenceVersion,
    formFields: [
      input("counterpartyCount", "Número de terceros declarados", "number", true),
      input("annualAmountEuros", "Importe anual total (€)", "number", true),
      input("quarterlyBreakdown", "Desglose por trimestre", "text", false, "Usa importes educativos agregados; no introduzcas datos personales reales."),
      input("thresholdReview", "Revisión del umbral por tercero", "checkbox", true, "La ficha oficial establece 3.005,06 € por contraparte; revisa las exclusiones aplicables."),
    ],
  },
  {
    modelCode: "420", taxType: "igic", agency: "atc", label: "Autoliquidación trimestral IGIC · régimen general",
    periodicity: "quarterly", officialUrl: "https://sede.gobiernodecanarias.org/sede/tramites/4015", referenceVersion,
    formFields: [
      input("taxableBaseEuros", "Base imponible (€)", "number", false, "Se obtiene de facturas del escenario."),
      input("outputIgicEuros", "IGIC devengado (€)", "number", false, "Se obtiene de facturas del escenario."),
      input("inputIgicEuros", "IGIC deducible (€)", "number", false, "Solo facturas de compra conformadas."),
      input("adjustmentsEuros", "Rectificaciones y ajustes (€)", "number"),
      input("resultEuros", "Resultado provisional (€)", "number", false, "Cálculo didáctico; no valida tipos ni deducciones legales."),
    ],
  },
  {
    modelCode: "421", taxType: "igic", agency: "atc", label: "Autoliquidación trimestral IGIC · régimen simplificado",
    periodicity: "quarterly", officialUrl: "https://sede.gobiernodecanarias.org/sede/tramites/4016", referenceVersion,
    formFields: [
      input("economicActivity", "Actividad o epígrafe", "text", true),
      input("moduleUnits", "Unidades de módulo declaradas", "text", true),
      input("quarterlyQuotaEuros", "Cuota trimestral educativa (€)", "number"),
      input("paymentsOnAccountEuros", "Ingresos a cuenta previos (€)", "number"),
      input("resultEuros", "Resultado provisional (€)", "number", false, "Introduce el resultado docente; el simulador no calcula módulos oficiales."),
    ],
  },
  {
    modelCode: "425", taxType: "igic", agency: "atc", label: "Declaración-resumen anual IGIC",
    periodicity: "annual", officialUrl: "https://sede.gobiernodecanarias.org/sede/tramites/4018", referenceVersion,
    formFields: [
      input("annualOutputIgicEuros", "IGIC devengado anual (€)", "number", false, "Resumen educativo basado en facturas."),
      input("annualInputIgicEuros", "IGIC deducible anual (€)", "number", false, "Resumen educativo de compras conformadas."),
      input("annualAdjustmentsEuros", "Regularizaciones anuales (€)", "number"),
      input("resultEuros", "Resultado provisional (€)", "number", false, "No sustituye a la declaración oficial."),
    ],
  },
  {
    modelCode: "036", taxType: "census_state", agency: "aeat", label: "Declaración censal estatal · alta, modificación o baja",
    periodicity: "census", officialUrl: aeat036, referenceVersion,
    formFields: [
      input("censusAction", "Causa de presentación", "select", true, undefined, ["Alta", "Modificación", "Baja"]),
      input("taxId", "NIF de la persona o entidad", "text", true),
      input("legalName", "Nombre o razón social", "text", true),
      input("effectiveDate", "Fecha de efecto", "date", true),
      input("taxAddress", "Domicilio fiscal", "text", true),
      input("economicActivity", "Actividad económica", "text"),
      input("taxObligations", "Obligaciones y regímenes a comunicar", "text", false, "Selecciona solo las obligaciones que correspondan al perfil educativo."),
    ],
  },
  {
    modelCode: "111", taxType: "withholding", agency: "aeat", label: "Retenciones e ingresos a cuenta · trabajo y actividades económicas",
    periodicity: "quarterly", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientos/GH01.shtml", referenceVersion,
    formFields: [
      input("recipientCount", "Número de perceptores", "number", true),
      input("withholdingBaseEuros", "Base de retenciones (€)", "number", true),
      input("withholdingEuros", "Retenciones e ingresos a cuenta (€)", "number", true),
      input("resultEuros", "Resultado provisional (€)", "number", false),
    ],
  },
  {
    modelCode: "190", taxType: "withholding", agency: "aeat", label: "Resumen anual de retenciones · trabajo y actividades económicas",
    periodicity: "annual", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/ayuda/consultas-informaticas/declaraciones-informativas-ayuda-tecnica/modelos-190-198.html", referenceVersion,
    formFields: [
      input("recipientCount", "Número anual de perceptores", "number", true),
      input("annualBaseEuros", "Bases anuales (€)", "number", true),
      input("annualWithholdingEuros", "Retenciones anuales (€)", "number", true),
      input("recipientSummary", "Resumen educativo por clave", "text", false, "No introduzcas nombres, NIF ni datos personales reales."),
    ],
  },
  {
    modelCode: "115", taxType: "withholding", agency: "aeat", label: "Retenciones por arrendamiento de inmuebles urbanos",
    periodicity: "quarterly", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientos/GH02.shtml", referenceVersion,
    formFields: [
      input("leasedPropertiesCount", "Número de inmuebles arrendados", "number", true),
      input("withholdingBaseEuros", "Base de arrendamientos (€)", "number", true),
      input("withholdingEuros", "Retenciones ingresadas (€)", "number", true),
      input("resultEuros", "Resultado provisional (€)", "number", false),
    ],
  },
  {
    modelCode: "180", taxType: "withholding", agency: "aeat", label: "Resumen anual de retenciones por arrendamientos",
    periodicity: "annual", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientos/GI00.shtml", referenceVersion,
    formFields: [
      input("leasedPropertiesCount", "Número anual de inmuebles", "number", true),
      input("annualBaseEuros", "Bases anuales (€)", "number", true),
      input("annualWithholdingEuros", "Retenciones anuales (€)", "number", true),
      input("recipientSummary", "Resumen educativo por inmueble", "text", false, "Usa referencias ficticias; no incluyas domicilios ni datos reales."),
    ],
  },
  {
    modelCode: "200", taxType: "corporate_tax", agency: "aeat", label: "Impuesto sobre Sociedades",
    periodicity: "annual", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GE04.shtml", referenceVersion,
    formFields: [
      input("accountingResultEuros", "Resultado contable (€)", "number", true),
      input("taxAdjustmentsEuros", "Ajustes fiscales educativos (€)", "number"),
      input("taxBaseEuros", "Base imponible educativa (€)", "number"),
      input("settledTaxEuros", "Cuota educativa (€)", "number"),
      input("resultEuros", "Resultado provisional (€)", "number", false, "El simulador no aplica tipos ni incentivos oficiales."),
    ],
  },
  {
    modelCode: "130", taxType: "personal_income", agency: "aeat", label: "Pago fraccionado IRPF · estimación directa",
    periodicity: "quarterly", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/G601.shtml", referenceVersion,
    formFields: [
      input("cumulativeIncomeEuros", "Ingresos acumulados (€)", "number", true),
      input("cumulativeExpensesEuros", "Gastos deducibles educativos (€)", "number", true),
      input("priorPaymentsEuros", "Pagos fraccionados anteriores (€)", "number"),
      input("resultEuros", "Resultado provisional (€)", "number", false, "No se aplica ningún porcentaje tributario."),
    ],
  },
  {
    modelCode: "131", taxType: "personal_income", agency: "aeat", label: "Pago fraccionado IRPF · estimación objetiva",
    periodicity: "quarterly", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/G602.shtml", referenceVersion,
    formFields: [
      input("economicActivity", "Actividad o epígrafe", "text", true),
      input("moduleUnits", "Unidades de módulo educativas", "text", true),
      input("priorPaymentsEuros", "Pagos fraccionados anteriores (€)", "number"),
      input("resultEuros", "Resultado provisional (€)", "number", false, "No se aplican índices ni módulos oficiales."),
    ],
  },
  {
    modelCode: "100", taxType: "personal_income", agency: "aeat", label: "Modelo 100 (D-100) · declaración anual del IRPF",
    periodicity: "annual", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/Ayuda/25Presentacion/100.html", referenceVersion,
    formFields: [
      input("economicIncomeEuros", "Rendimientos de actividades educativas (€)", "number"),
      input("withholdingsEuros", "Retenciones y pagos a cuenta (€)", "number"),
      input("resultEuros", "Resultado provisional (€)", "number", false, "Plantilla parcial; no calcula la declaración íntegra del IRPF."),
    ],
  },
  {
    modelCode: "347", taxType: "informative_state", agency: "aeat", label: "Declaración anual de operaciones con terceras personas",
    periodicity: "annual", officialUrl: "https://sede.agenciatributaria.gob.es/Sede/todas-gestiones/impuestos-tasas/declaraciones-informativas/modelo-347-decla_____racion-anual-operaciones-personas_/instrucciones.html", referenceVersion,
    formFields: [
      input("counterpartyCount", "Número de terceros declarados", "number", true),
      input("annualAmountEuros", "Importe anual total (€)", "number", true),
      input("quarterlyBreakdown", "Desglose trimestral educativo", "text"),
      input("thresholdReview", "Revisión del umbral por tercero", "checkbox", true, "La ficha oficial indica 3.005,06 €; revisa exclusiones y reglas vigentes."),
    ],
  },
];

export type TaxProfileInput = Omit<TaxProfile, "organizationId" | "updatedByName" | "updatedAt"> & {
  organizationId: string;
};

export function getTaxModel(modelCode: string): TaxModelDefinition | undefined {
  return TAX_MODEL_CATALOG.find((model) => model.modelCode === modelCode);
}

export function getModelTaxType(modelCode: string): TaxType | undefined {
  return getTaxModel(modelCode)?.taxType;
}

export function modelMatchesPeriod(modelCode: string, annual: boolean): boolean {
  const model = getTaxModel(modelCode);
  if (!model) return false;
  if (model.periodicity === "census") return annual;
  return model.periodicity === "annual" ? annual : !annual;
}

export function buildModelCatalog(
  profile: TaxProfile | null,
  thirdPartyThresholdReached: boolean,
) {
  return TAX_MODEL_CATALOG.map((model) => {
    const payable = ["420", "421", "111", "115", "130", "131", "100", "200"].includes(model.modelCode);
    const result = (applicable: boolean, applicabilityNote: string) => ({
      ...model, applicable, applicabilityNote, payable,
    });
    if (!profile) {
      return result(false, "Configura el perfil fiscal antes de determinar si corresponde.");
    }
    switch (model.modelCode) {
      case "400":
      case "036":
        return result(true, "Trámite censal disponible para altas, modificaciones o bajas; no es periódico.");
      case "420":
        return result(profile.igicRegime === "general", profile.igicRegime === "general" ? "Corresponde al régimen general seleccionado." : "No corresponde al régimen IGIC simplificado seleccionado.");
      case "421":
        return result(profile.igicRegime === "simplified", profile.igicRegime === "simplified" ? "Corresponde al régimen simplificado seleccionado." : "No corresponde al régimen IGIC general seleccionado.");
      case "415":
      case "347":
        return result(thirdPartyThresholdReached, thirdPartyThresholdReached
          ? "Los registros educativos superan 3.005,06 € por contraparte; revisa exclusiones antes de usar el modelo."
          : "Disponible para práctica; los registros revisados no alcanzan 3.005,06 € por contraparte.");
      case "425":
        return result(true, "Resumen anual para entidades con obligaciones periódicas de IGIC.");
      case "111":
      case "190":
        return result(profile.hasEmployees || profile.withholdsProfessionals, profile.hasEmployees || profile.withholdsProfessionals
          ? "El perfil declara personal o profesionales con retención."
          : "Solo corresponde si se satisfacen rentas sujetas a retención.");
      case "115":
      case "180":
        return result(profile.paysBusinessRent, profile.paysBusinessRent
          ? "El perfil declara arrendamiento de inmueble urbano sujeto a retención."
          : "Solo corresponde si se pagan rentas sujetas por arrendamiento de inmueble urbano.");
      case "200":
        return result(profile.entityType === "sociedad", profile.entityType === "sociedad" ? "Impuesto sobre Sociedades para la forma jurídica seleccionada." : "No corresponde al perfil de persona física.");
      case "130":
        return result(profile.entityType === "autonomo" && profile.incomeTaxMethod === "direct", profile.entityType === "autonomo" && profile.incomeTaxMethod === "direct"
          ? "Estimación directa seleccionada para la persona física."
          : "Solo para personas físicas en estimación directa.");
      case "131":
        return result(profile.entityType === "autonomo" && profile.incomeTaxMethod === "objective", profile.entityType === "autonomo" && profile.incomeTaxMethod === "objective"
          ? "Estimación objetiva seleccionada para la persona física."
          : "Solo para personas físicas en estimación objetiva.");
      case "100":
        return result(profile.entityType === "autonomo", profile.entityType === "autonomo"
          ? "Declaración anual de IRPF para persona física."
          : "No corresponde a una sociedad mercantil.");
      default:
        return result(false, "Revisa el perfil fiscal y las circunstancias del ejercicio.");
    }
  });
}
