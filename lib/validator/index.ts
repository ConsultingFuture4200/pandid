// Public surface of the validator (DEV-1133, PRD §5.3).
//
// The ONLY import seam callers use. Concrete connectivity rules are an
// implementation detail behind `createConnectivityValidator` / `createValidator`;
// callers depend on the `Validator` interface and the report shape only, so v2
// domain rules slot in without touching them (FR-12).
//
// Consumers:
//   - DEV-1140 commit pipeline      → createConnectivityValidator
//   - DEV-1144/1150 proposal staging → createConnectivityValidator + ValidationReport
//   - `validate_active_diagram` MCP read tool → createConnectivityValidator

export type {
  DiagramElement,
  DiagramSnapshot,
  ValidationError,
  ValidationReport,
  ValidationRule,
  ValidationRuleCode,
  Validator,
} from "./types";

export {
  createConnectivityValidator,
  createValidator,
} from "./validator";

export {
  CONNECTIVITY_RULES,
  endpointBindingRule,
  requiredAttributesRule,
  uniqueTagRule,
} from "./connectivity-rules";
