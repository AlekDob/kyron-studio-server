import { z, type ZodTypeAny } from "zod";

/**
 * Convertitore minimale JSON Schema -> Zod.
 *
 * Gestisce i casi tipici esposti dai tool MCP:
 *  - type: object (+ properties + required)
 *  - type: string (+ enum, description)
 *  - type: number / integer
 *  - type: boolean
 *  - type: array (+ items)
 *  - anyOf / oneOf (fallback union)
 *
 * Fallback: z.any() su costrutti non supportati.
 *
 * NB: non e' un compliance-level converter; lo scopo e' dare al modello LLM
 * uno schema utilizzabile per tool calling. Il server MCP valida comunque
 * i dati finali, quindi errori di parsing client-side diventano errori runtime
 * del tool (cosa che l'agente puo' gestire e correggere).
 */

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  description?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  [k: string]: unknown;
}

export function jsonSchemaToZod(schema: unknown): ZodTypeAny {
  if (schema == null || typeof schema !== "object") return z.any();
  const s = schema as JsonSchema;

  if (s.anyOf || s.oneOf) {
    const variants = (s.anyOf ?? s.oneOf ?? []).map(jsonSchemaToZod);
    if (variants.length === 0) return z.any();
    if (variants.length === 1) return variants[0]!;
    return z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  if (Array.isArray(s.enum) && s.enum.length > 0) {
    const literals: ZodTypeAny[] = s.enum.map((v) =>
      z.literal(v as string | number | boolean),
    );
    if (literals.length === 1) {
      return applyDescription(literals[0]!, s.description);
    }
    const [a, b, ...rest] = literals;
    return applyDescription(z.union([a!, b!, ...rest]), s.description);
  }

  const type = Array.isArray(s.type) ? s.type[0] : s.type;

  switch (type) {
    case "string":
      return applyDescription(z.string(), s.description);
    case "number":
    case "integer":
      return applyDescription(z.number(), s.description);
    case "boolean":
      return applyDescription(z.boolean(), s.description);
    case "null":
      return z.null();
    case "array": {
      const items = Array.isArray(s.items) ? s.items[0] : s.items;
      const inner = items ? jsonSchemaToZod(items) : z.any();
      return applyDescription(z.array(inner), s.description);
    }
    case "object": {
      const props = s.properties ?? {};
      const required = new Set(s.required ?? []);
      const shape: Record<string, ZodTypeAny> = {};
      for (const [key, subSchema] of Object.entries(props)) {
        const inner = jsonSchemaToZod(subSchema);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      // passthrough cosi' il modello puo' passare extra senza errori duri
      return applyDescription(z.object(shape).passthrough(), s.description);
    }
    default:
      return z.any();
  }
}

function applyDescription(schema: ZodTypeAny, description?: string): ZodTypeAny {
  return description ? schema.describe(description) : schema;
}
