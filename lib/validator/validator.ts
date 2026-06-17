// Validator factory — composes rules behind the stable `Validator` interface
// (DEV-1133, FR-12).
//
// Callers build a `Validator` from a set of rules and depend only on
// `Validator.validate`. v1 wires the connectivity rule set; v2 passes the same
// connectivity rules PLUS domain rules — no caller change. This composition seam
// is the "validator behind an interface" architecture invariant (CLAUDE.md).

import { CONNECTIVITY_RULES } from "./connectivity-rules";
import type {
  DiagramSnapshot,
  ValidationError,
  ValidationReport,
  ValidationRule,
  Validator,
} from "./types";

/**
 * Compose a `Validator` from an ordered rule set. Each rule runs over the same
 * snapshot; their errors are concatenated in rule order. Pure and deterministic:
 * the same snapshot always yields the same report (the reliability model in
 * PRD §8 depends on this — "reliably" is delivered by code, not the model).
 */
export function createValidator(
  rules: readonly ValidationRule[] = CONNECTIVITY_RULES,
): Validator {
  return {
    validate(snapshot: DiagramSnapshot): ValidationReport {
      const errors: ValidationError[] = [];
      for (const rule of rules) {
        errors.push(...rule.validate(snapshot));
      }
      return { valid: errors.length === 0, errors };
    },
  };
}

/**
 * The default v1 validator: connectivity/structural rules only. This is what the
 * commit pipeline (DEV-1140) and propose tools (DEV-1150) instantiate.
 */
export function createConnectivityValidator(): Validator {
  return createValidator(CONNECTIVITY_RULES);
}
