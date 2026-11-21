// src/core/errors.ts
const KNOWN_ERROR_CODES = {
	INVALID_OPTION: true,
	INVALID_RECORD: true,
	INVALID_ID: true,
	DUPLICATE_ID: true,
	UNKNOWN_ID: true,
	QUERY_TOO_LONG: true,
	TOO_MANY_TERMS: true,
	INVALID_TOKEN_SPAN: true,
	INVALID_PIPELINE_OUTPUT: true,
	INDEX_BUSY: true,
	ABORTED: true,
	INVALID_SERIALIZED_INDEX: true,
	UNSUPPORTED_VERSION: true,
	SERIALIZED_INDEX_TOO_LARGE: true,
	SEGMENTER_UNAVAILABLE: true
};
/** @public */
var TyposeekError = class extends Error {
	name = "TyposeekError";
	code;
	recordIndex;
	constructor(code, message, details) {
		super(message, details);
		this.code = code;
		this.recordIndex = details?.recordIndex;
	}
};
/** @public */
function isTyposeekError(value) {
	return typeof value === "object" && value !== null && "name" in value && value.name === "TyposeekError" && "code" in value && typeof value.code === "string" && Object.hasOwn(KNOWN_ERROR_CODES, value.code);
}
const INVARIANT_VIOLATION_PREFIX = "typoseek invariant violated: ";
function invariantViolation(detail) {
	return /* @__PURE__ */ new Error(`${INVARIANT_VIOLATION_PREFIX}${detail}`);
}

export { invariantViolation as n, isTyposeekError as r, TyposeekError as t };