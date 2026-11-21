import { n as invariantViolation, t as TyposeekError } from "./errors-DcnmNX-E.mjs";

// src/core/fold.ts
const NON_ASCII = /\P{ASCII}/u;
const REMOVED_COMBINING_MARKS = /[̀-ͯ]|[᪰-᫿]|[᷀-᷿]|[⃐-⃿]|[︠-︯]/gu;
const FOLDS_LEFT_BY_DECOMPOSITION = /* @__PURE__ */ new Map([
	["ß", "ss"],
	["æ", "ae"],
	["œ", "oe"],
	["ø", "o"],
	["đ", "d"],
	["ł", "l"],
	["ı", "i"],
	["ς", "σ"],
	["þ", "th"],
	["‘", "'"],
	["’", "'"],
	["‚", "'"],
	["‛", "'"],
	["′", "'"],
	["“", "\""],
	["”", "\""],
	["„", "\""],
	["‟", "\""],
	["«", "\""],
	["»", "\""],
	["‐", "-"],
	["‒", "-"],
	["–", "-"],
	["—", "-"],
	["―", "-"],
	["−", "-"]
]);
function removeMarksKeepingCanonicalOrder(decomposed) {
	return decomposed.replace(REMOVED_COMBINING_MARKS, "").normalize("NFKD");
}
function foldCharacter(character) {
	return FOLDS_LEFT_BY_DECOMPOSITION.get(character) ?? character;
}
/** @public */
function foldTerm(term) {
	if (!NON_ASCII.test(term)) return term.toLowerCase();
	const unmarked = removeMarksKeepingCanonicalOrder(term.normalize("NFKD"));
	return Array.from(unmarked.toLowerCase(), foldCharacter).join("");
}

// src/core/tokenize.ts
const TOKEN_PATTERN = /[\p{L}\p{N}\p{M}]+/gu;
/** @public */
function tokenize(text) {
	return Array.from(text.matchAll(TOKEN_PATTERN), (match) => ({
		start: match.index,
		end: match.index + match[0].length
	}));
}
function isIterableObject(value) {
	return typeof value === "object" && value !== null && Symbol.iterator in value && typeof value[Symbol.iterator] === "function";
}
function hasOffsets(value) {
	return typeof value === "object" && value !== null && "start" in value && "end" in value;
}
function isOffset(value) {
	return Number.isInteger(value);
}
function invalidSpan(message) {
	return new TyposeekError("INVALID_TOKEN_SPAN", message);
}
function validateSpans(spans, textLength) {
	if (!isIterableObject(spans)) throw invalidSpan("tokenizer result must be an iterable object of spans");
	const validated = [];
	let previousEnd = 0;
	for (const span of spans) {
		const position = String(validated.length);
		if (!hasOffsets(span)) throw invalidSpan(`token span ${position} must be an object with start and end`);
		const { start, end } = span;
		if (!isOffset(start) || !isOffset(end)) throw invalidSpan(`token span ${position} must have integer start and end`);
		if (start < previousEnd || end <= start || end > textLength) throw invalidSpan(`token span ${position} must be non-empty, ordered and inside text of length ${String(textLength)}`);
		validated.push({
			start,
			end
		});
		previousEnd = end;
	}
	return validated;
}

// src/core/paths.ts
const MAX_KEY_PATH_SEGMENTS = 5;
const KEY_PATH_RULE = `a dotted path of 1 to ${String(MAX_KEY_PATH_SEGMENTS)} non-empty segments, none of them __proto__, constructor or prototype`;
const FORBIDDEN_PROPERTY_NAMES = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]);
function isForbiddenPropertyName(name) {
	return FORBIDDEN_PROPERTY_NAMES.has(name);
}
function isAcceptedSegment(segment) {
	return segment !== "" && !isForbiddenPropertyName(segment);
}
function parseKeyPath(path) {
	const segments = path.split(".", 6);
	if (segments.length > MAX_KEY_PATH_SEGMENTS || !segments.every(isAcceptedSegment)) return;
	return Object.freeze(segments);
}
function isObjectRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isArray(value) {
	return Array.isArray(value);
}
const CHARGE_NOTHING = () => void 0;
function collectLeaves(record, segments, toLeaf, chargeArrayLength) {
	const leaves = [];
	const visitedArrays = /* @__PURE__ */ new Set();
	const cursors = [];
	const visit = (value, depth) => {
		let current = value;
		let level = depth;
		for (let segment = segments[level]; segment !== void 0 && !isArray(current); segment = segments[level]) {
			if (!isObjectRecord(current) || !Object.hasOwn(current, segment)) return;
			current = current[segment];
			level += 1;
		}
		if (!isArray(current)) {
			const leaf = toLeaf(current);
			if (leaf !== void 0) leaves.push(leaf);
		} else if (!visitedArrays.has(current)) {
			visitedArrays.add(current);
			const { length } = current;
			chargeArrayLength(length);
			cursors.push({
				array: current,
				length,
				depth: level,
				nextIndex: 0
			});
		}
	};
	visit(record, 0);
	for (let cursor = cursors.at(-1); cursor !== void 0; cursor = cursors.at(-1)) {
		const index = cursor.nextIndex;
		if (index >= cursor.length) cursors.pop();
		else {
			cursor.nextIndex = index + 1;
			if (Object.hasOwn(cursor.array, index)) visit(cursor.array[index], cursor.depth);
		}
	}
	return leaves;
}
function toText(value) {
	if (typeof value === "string") return value;
	return typeof value === "number" && Number.isFinite(value) ? String(value) : void 0;
}
function resolveText(record, segments) {
	return collectLeaves(record, segments, toText, CHARGE_NOTHING);
}
function resolveMeteredText(record, segments, chargeArrayLength) {
	return collectLeaves(record, segments, toText, chargeArrayLength);
}
function isDate(value) {
	return typeof value === "object" && value !== null && !(Symbol.toStringTag in value) && Object.prototype.toString.call(value) === "[object Date]";
}
function toComparableValue(value) {
	if (typeof value === "string" || typeof value === "boolean" || value === null) return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
	if (!isDate(value)) return;
	const dateMs = Date.prototype.getTime.call(value);
	return Number.isFinite(dateMs) ? { dateMs } : void 0;
}
function resolveValues(record, segments) {
	return collectLeaves(record, segments, toComparableValue, CHARGE_NOTHING);
}

// src/core/filters.ts
function invalidOption$2(option, rule) {
	return new TyposeekError("INVALID_OPTION", `${option} ${rule}`);
}
function keySegments(key, option) {
	const segments = typeof key === "string" ? parseKeyPath(key) : void 0;
	if (segments === void 0) throw invalidOption$2(option, `must be ${KEY_PATH_RULE}`);
	return segments;
}
function toNumber(value) {
	if (typeof value === "number") return value;
	return typeof value === "object" && value !== null ? value.dateMs : void 0;
}
function boundOf(bound, option, unbounded) {
	if (bound === void 0) return unbounded;
	const numeric = toNumber(toComparableValue(bound));
	if (numeric === void 0) throw invalidOption$2(option, "must be a finite number or a valid Date");
	return numeric;
}
function toNumericRange(bounds, option) {
	if (!isObjectRecord(bounds)) throw invalidOption$2(option, "must be an object with gt, gte, lt or lte");
	const { gt, gte, lt, lte } = bounds;
	if (gt === void 0 && gte === void 0 && lt === void 0 && lte === void 0) throw invalidOption$2(option, "needs at least one of gt, gte, lt and lte");
	if (gt !== void 0 && gte !== void 0) throw invalidOption$2(option, "cannot have both gt and gte");
	if (lt !== void 0 && lte !== void 0) throw invalidOption$2(option, "cannot have both lt and lte");
	return {
		lower: gt === void 0 ? boundOf(gte, `${option}.gte`, -Infinity) : boundOf(gt, `${option}.gt`, -Infinity),
		lowerInclusive: gt === void 0,
		upper: lt === void 0 ? boundOf(lte, `${option}.lte`, Infinity) : boundOf(lt, `${option}.lt`, Infinity),
		upperInclusive: lt === void 0
	};
}
function isInside(value, range) {
	const aboveLower = range.lowerInclusive ? value >= range.lower : value > range.lower;
	const belowUpper = range.upperInclusive ? value <= range.upper : value < range.upper;
	return aboveLower && belowUpper;
}
function isEqualsValue(value) {
	return typeof value === "string" || typeof value === "boolean" || value === null || typeof value === "number" && Number.isFinite(value);
}
function compileRangePredicate(segments, range) {
	return (item) => resolveValues(item, segments).some((value) => {
		const numeric = toNumber(value);
		return numeric !== void 0 && isInside(numeric, range);
	});
}
function compileEqualsPredicate(segments, equals) {
	return (item) => resolveValues(item, segments).some((value) => value === equals);
}
function compileKeyFilter(spec, option) {
	if (!isObjectRecord(spec)) throw invalidOption$2(option, "must be a predicate or an object with key and equals or range");
	const segments = keySegments(spec.key, `${option}.key`);
	const { equals, range } = spec;
	if (equals === void 0 === (range === void 0)) throw invalidOption$2(option, "must have exactly one of equals and range");
	if (range !== void 0) return compileRangePredicate(segments, toNumericRange(range, `${option}.range`));
	if (!isEqualsValue(equals)) throw invalidOption$2(`${option}.equals`, "must be a string, a finite number, a boolean or null");
	return compileEqualsPredicate(segments, equals);
}
function compileOne(filter, option) {
	return typeof filter === "function" ? filter : compileKeyFilter(filter, option);
}
function isFilterList(filter) {
	return Array.isArray(filter);
}
function compileFilter(filter) {
	if (filter === void 0) return;
	if (!isFilterList(filter)) return compileOne(filter, "filter");
	const predicates = filter.map((entry, index) => compileOne(entry, `filter[${String(index)}]`));
	return (item) => predicates.every((predicate) => predicate(item));
}
const MISSING_SORT_KEY = Object.freeze({ kind: "missing" });
const ASCENDING_KIND_RANK = {
	number: 0,
	string: 1,
	boolean: 2
};
const ASCENDING_SIGN = 1;
const DESCENDING_SIGN = -1;
function toSortKey(value) {
	if (typeof value === "string") return {
		kind: "string",
		value
	};
	if (typeof value === "boolean") return {
		kind: "boolean",
		value
	};
	const numeric = toNumber(value);
	return numeric === void 0 ? MISSING_SORT_KEY : {
		kind: "number",
		value: numeric
	};
}
function compareCodeUnits(a, b) {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}
function compareAscending(a, b) {
	if (a.kind === "number" && b.kind === "number") return a.value - b.value;
	if (a.kind === "string" && b.kind === "string") return compareCodeUnits(a.value, b.value);
	if (a.kind === "boolean" && b.kind === "boolean") return Number(a.value) - Number(b.value);
	return ASCENDING_KIND_RANK[a.kind] - ASCENDING_KIND_RANK[b.kind];
}
function directionSign(direction) {
	if (direction === void 0 || direction === "asc") return ASCENDING_SIGN;
	if (direction === "desc") return DESCENDING_SIGN;
	throw invalidOption$2("sortBy.direction", "must be 'asc' or 'desc'");
}
function compileSort(sortBy) {
	if (sortBy === void 0) return;
	const spec = sortBy;
	if (!isObjectRecord(spec)) throw invalidOption$2("sortBy", "must be an object with key and an optional direction");
	const segments = keySegments(spec.key, "sortBy.key");
	const sign = directionSign(spec.direction);
	return Object.freeze({
		keyOf: (item) => toSortKey(resolveValues(item, segments)[0]),
		compare: (a, b) => {
			if (a.kind === "missing" || b.kind === "missing") return Number(a.kind === "missing") - Number(b.kind === "missing");
			return sign * compareAscending(a, b);
		}
	});
}

// src/core/options.ts
const DEFAULT_LIMITS = Object.freeze({
	maxQueryLength: 256,
	maxQueryTerms: 16,
	maxExpansions: 50
});
const LIMIT_RANGES = {
	maxQueryLength: {
		min: 1,
		max: 4096
	},
	maxQueryTerms: {
		min: 1,
		max: 64
	},
	maxExpansions: {
		min: 1,
		max: 1e3
	}
};
function invalidOption$1(problem) {
	return new TyposeekError("INVALID_OPTION", problem);
}
function isIntegerInRange(value, range) {
	return typeof value === "number" && Number.isInteger(value) && value >= range.min && value <= range.max;
}
function rangeProblem(option, range) {
	return `${option} must be ${range.max === Infinity ? `an integer >= ${String(range.min)}` : `an integer from ${String(range.min)} to ${String(range.max)}`}`;
}
function checkIntegerFields(option, partial, ranges) {
	if (partial === void 0) return { values: {} };
	if (!isObjectRecord(partial)) return { problem: `${option} must be an object` };
	const values = {};
	for (const [field, range] of Object.entries(ranges)) {
		const value = partial[field];
		if (value === void 0) continue;
		if (!isIntegerInRange(value, range)) return { problem: rangeProblem(`${option}.${field}`, range) };
		values[field] = value;
	}
	return { values };
}
function checkLimits(partial) {
	const check = checkIntegerFields("limits", partial, LIMIT_RANGES);
	return "problem" in check ? check : { limits: Object.freeze({
		...DEFAULT_LIMITS,
		...check.values
	}) };
}
function resolveLimits(partial) {
	const check = checkLimits(partial);
	if ("problem" in check) throw invalidOption$1(check.problem);
	return check.limits;
}
const DEFAULT_LOAD_LIMITS = Object.freeze({
	maxRecords: 1e6,
	maxSurfaces: 5e6,
	maxTokens: 5e7,
	maxStopTerms: 1e4,
	maxTextLength: 1e9
});
const POSITIVE_INTEGER = {
	min: 1,
	max: Infinity
};
const LOAD_LIMIT_RANGES = {
	maxRecords: POSITIVE_INTEGER,
	maxSurfaces: POSITIVE_INTEGER,
	maxTokens: POSITIVE_INTEGER,
	maxStopTerms: POSITIVE_INTEGER,
	maxTextLength: POSITIVE_INTEGER
};
function resolveLoadLimits(partial) {
	const check = checkIntegerFields("loadLimits", partial, LOAD_LIMIT_RANGES);
	if ("problem" in check) throw invalidOption$1(check.problem);
	return Object.freeze({
		...DEFAULT_LOAD_LIMITS,
		...check.values
	});
}
function isValidIdKey(value) {
	return typeof value === "string" && value !== "" && !isForbiddenPropertyName(value);
}
function resolveIdKey(value) {
	if (!isValidIdKey(value)) throw invalidOption$1("idKey must be a non-empty string other than __proto__, constructor and prototype");
	return value;
}
const SELF_FIELD = Object.freeze({
	path: "",
	segments: Object.freeze([]),
	weight: 1
});
const DEFAULT_KEY_WEIGHT = 1;
function isPositiveFinite(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function toField(path, weight, option) {
	if (typeof path === "string") {
		const segments = parseKeyPath(path);
		if (segments !== void 0) return { field: Object.freeze({
			path,
			segments,
			weight
		}) };
	}
	return { problem: `${option} must be ${KEY_PATH_RULE}` };
}
function checkKeySpec(spec, option) {
	if (typeof spec === "string") return toField(spec, DEFAULT_KEY_WEIGHT, option);
	if (!isObjectRecord(spec)) return { problem: `${option} must be a key path or an object with path and weight` };
	const { path, weight } = spec;
	if (!isPositiveFinite(weight)) return { problem: `${option}.weight must be a finite number > 0` };
	return toField(path, weight, `${option}.path`);
}
function checkKeySpecs(specs) {
	if (!isArray(specs) || specs.length === 0) return { problem: "keys must be a non-empty array of key paths or objects with path and weight" };
	const fields = [];
	const seenPaths = /* @__PURE__ */ new Set();
	for (const [index, spec] of specs.entries()) {
		const option = `keys[${String(index)}]`;
		const check = checkKeySpec(spec, option);
		if ("problem" in check) return check;
		if (seenPaths.has(check.field.path)) return { problem: `${option} repeats the path of an earlier key` };
		seenPaths.add(check.field.path);
		fields.push(check.field);
	}
	return { fields: Object.freeze(fields) };
}
function resolveKeySpecs(specs) {
	const check = checkKeySpecs(specs);
	if ("problem" in check) throw invalidOption$1(check.problem);
	return check.fields;
}
const NO_STOP_WORDS = Object.freeze([]);
function toOptionObject(options) {
	if (!isObjectRecord(options)) throw invalidOption$1("options must be an object");
	return options;
}
function isTokenizer(value) {
	return typeof value === "function";
}
function isTermFunction(value) {
	return typeof value === "function";
}
function hookOption(value, option, isHook) {
	if (value === void 0 || isHook(value)) return value;
	throw invalidOption$1(`${option} must be a function`);
}
function resolveHooks(options) {
	return Object.freeze({
		tokenize: hookOption(options.tokenize, "tokenize", isTokenizer),
		normalize: hookOption(options.normalize, "normalize", isTermFunction),
		stem: hookOption(options.stem, "stem", isTermFunction)
	});
}
function resolveStopWords(value) {
	if (value === void 0) return NO_STOP_WORDS;
	if (!isIterableObject(value)) throw invalidOption$1("stopWords must be an iterable of strings, not a string");
	const stopWords = [];
	for (const word of value) {
		if (typeof word !== "string") throw invalidOption$1("stopWords must hold only strings");
		stopWords.push(word);
	}
	return Object.freeze(stopWords);
}
function resolvePipelineOptions(options) {
	const source = toOptionObject(options);
	return Object.freeze({
		hooks: resolveHooks(source),
		stopWords: resolveStopWords(source.stopWords)
	});
}
const SNAPSHOT_OWNED_OPTIONS = ["stopWords", "limits"];
function resolveLoadOptions(options) {
	const source = toOptionObject(options);
	const snapshotOwned = SNAPSHOT_OWNED_OPTIONS.find((option) => Object.hasOwn(source, option));
	if (snapshotOwned !== void 0) throw invalidOption$1(`${snapshotOwned} cannot be passed to loadIndex, because the snapshot holds it`);
	return Object.freeze({
		hooks: resolveHooks(source),
		loadLimits: resolveLoadLimits(source.loadLimits)
	});
}
const DEFAULT_TYPOS = Object.freeze({
	minLengthForOne: 4,
	minLengthForTwo: 8
});
const MIN_LENGTH_FOR_ONE_RANGE = {
	min: 1,
	max: Infinity
};
const BOOLEAN_SEARCH_DEFAULTS = {
	prefix: true,
	infix: true,
	fold: true,
	truncateQuery: false
};
const DEFAULT_SEARCH_LIMIT = 20;
const SEARCH_LIMIT_RANGE = {
	min: 0,
	max: 1e3
};
const DEFAULT_OFFSET = 0;
const OFFSET_RANGE = {
	min: 0,
	max: Infinity
};
const NO_OPTIONS = Object.freeze({});
function integerOption(value, option, fallback, range) {
	if (value === void 0) return fallback;
	if (!isIntegerInRange(value, range)) throw invalidOption$1(rangeProblem(option, range));
	return value;
}
function booleanOption(options, option) {
	const value = options[option];
	if (value === void 0) return BOOLEAN_SEARCH_DEFAULTS[option];
	if (typeof value !== "boolean") throw invalidOption$1(`${option} must be a boolean`);
	return value;
}
function modeOption(value) {
	if (value === void 0) return "and";
	if (value !== "and" && value !== "or") throw invalidOption$1("mode must be 'and' or 'or'");
	return value;
}
function isMinLengthForTwo(value, minLengthForOne) {
	return value === Infinity || isIntegerInRange(value, {
		min: minLengthForOne,
		max: Infinity
	});
}
function typosOption(value) {
	if (value === void 0) return DEFAULT_TYPOS;
	if (value === false) return false;
	if (!isObjectRecord(value)) throw invalidOption$1("typos must be false or an object");
	const minLengthForOne = integerOption(value.minLengthForOne, "typos.minLengthForOne", DEFAULT_TYPOS.minLengthForOne, MIN_LENGTH_FOR_ONE_RANGE);
	const { minLengthForTwo = DEFAULT_TYPOS.minLengthForTwo } = value;
	if (!isMinLengthForTwo(minLengthForTwo, minLengthForOne)) throw invalidOption$1("typos.minLengthForTwo must be an integer >= typos.minLengthForOne, or Infinity");
	return Object.freeze({
		minLengthForOne,
		minLengthForTwo
	});
}
function resolveSearchOptions(options) {
	const source = options === void 0 ? NO_OPTIONS : toOptionObject(options);
	return Object.freeze({
		mode: modeOption(source.mode),
		prefix: booleanOption(source, "prefix"),
		infix: booleanOption(source, "infix"),
		typos: typosOption(source.typos),
		fold: booleanOption(source, "fold"),
		filter: compileFilter(options?.filter),
		sortBy: compileSort(options?.sortBy),
		limit: integerOption(source.limit, "limit", DEFAULT_SEARCH_LIMIT, SEARCH_LIMIT_RANGE),
		offset: integerOption(source.offset, "offset", DEFAULT_OFFSET, OFFSET_RANGE),
		truncateQuery: booleanOption(source, "truncateQuery")
	});
}
function capQueryLength(query, maxCodePoints, truncate) {
	let codePoints = 0;
	let keptLength = 0;
	for (const codePoint of query) {
		if (codePoints === maxCodePoints) {
			if (!truncate) throw new TyposeekError("QUERY_TOO_LONG", `query exceeds limits.maxQueryLength of ${String(maxCodePoints)} code points`);
			return query.slice(0, keptLength);
		}
		codePoints += 1;
		keptLength += codePoint.length;
	}
	return query;
}
function capTerms(terms, maxTerms, truncate) {
	if (terms.length <= maxTerms) return terms;
	if (!truncate) throw new TyposeekError("TOO_MANY_TERMS", `query exceeds limits.maxQueryTerms of ${String(maxTerms)} terms`);
	return terms.slice(0, maxTerms);
}
function typoLimit(codePointLength, typos) {
	if (codePointLength >= typos.minLengthForTwo) return 2;
	return codePointLength >= typos.minLengthForOne ? 1 : 0;
}

// src/core/distance.ts
const UNREACHABLE = Number.POSITIVE_INFINITY;
function firstOsaRow(targetLength) {
	return {
		cells: Array.from({ length: targetLength + 1 }, (_, column) => column),
		cellsOfRowBefore: [],
		sourceLength: 0,
		sourceCharacter: void 0,
		last: targetLength,
		minimum: 0
	};
}
function nextOsaRow(target, previous, sourceCharacter) {
	const cells = [];
	let column = 0;
	let targetCharacter;
	let targetCharacterBefore;
	let beforeSwappedPair = UNREACHABLE;
	let beforeNextSwappedPair = UNREACHABLE;
	let diagonal = UNREACHABLE;
	let left = UNREACHABLE;
	let minimum = UNREACHABLE;
	for (const above of previous.cells) {
		const isAdjacentSwap = sourceCharacter === targetCharacterBefore && previous.sourceCharacter === targetCharacter;
		left = Math.min(above + 1, left + 1, diagonal + (sourceCharacter === targetCharacter ? 0 : 1), isAdjacentSwap ? beforeSwappedPair + 1 : UNREACHABLE);
		cells.push(left);
		minimum = Math.min(minimum, left);
		diagonal = above;
		targetCharacterBefore = targetCharacter;
		targetCharacter = target[column];
		beforeSwappedPair = beforeNextSwappedPair;
		beforeNextSwappedPair = previous.cellsOfRowBefore[column] ?? UNREACHABLE;
		column += 1;
	}
	return {
		cells,
		cellsOfRowBefore: previous.cells,
		sourceLength: previous.sourceLength + 1,
		sourceCharacter,
		last: left,
		minimum
	};
}
function lastOsaRow(source, target) {
	return source.reduce((row, sourceCharacter) => nextOsaRow(target, row, sourceCharacter), firstOsaRow(target.length));
}
function withinEdits(distance, maxEdits) {
	return distance <= maxEdits ? distance : void 0;
}
function boundedOsaDistance(a, b, maxEdits) {
	const source = Array.from(a);
	const target = Array.from(b);
	if (Math.abs(source.length - target.length) > maxEdits) return;
	return withinEdits(lastOsaRow(source, target).last, maxEdits);
}
function boundedPrefixDistance(query, candidate, maxEdits) {
	const source = Array.from(query);
	return withinEdits(lastOsaRow(source, Array.from(candidate).slice(0, source.length + maxEdits)).minimum, maxEdits);
}

// src/core/heap.ts
var BinaryHeap = class {
	items = [];
	compare;
	constructor(compare) {
		this.compare = compare;
	}
	get size() {
		return this.items.length;
	}
	peek() {
		return this.items[0];
	}
	push(item) {
		let index = this.items.length;
		this.items.push(item);
		for (;;) {
			const parentIndex = index - 1 >> 1;
			const parent = this.items[parentIndex];
			if (parent === void 0 || this.compare(parent, item) <= 0) break;
			this.items[index] = parent;
			index = parentIndex;
		}
		this.items[index] = item;
	}
	pop() {
		const top = this.items[0];
		const last = this.items.pop();
		if (last === void 0 || this.items.length === 0) return top;
		let index = 0;
		for (;;) {
			const rightIndex = 2 * index + 2;
			const left = this.items[rightIndex - 1];
			const right = this.items[rightIndex];
			if (left === void 0) break;
			const rightIsFirst = right !== void 0 && this.compare(right, left) < 0;
			const child = rightIsFirst ? right : left;
			if (this.compare(last, child) <= 0) break;
			this.items[index] = child;
			index = rightIsFirst ? rightIndex : rightIndex - 1;
		}
		this.items[index] = last;
		return top;
	}
};

// src/core/radix-tree.ts
const HIGH_SURROGATE_START = 55296;
const LOW_SURROGATE_START = 56320;
const SURROGATE_END = 57343;
const SURROGATE_PAYLOAD_SIZE = 1024;
const FIRST_ASTRAL_CODE_POINT = 65536;
function isHighSurrogate(codeUnit) {
	return codeUnit >= HIGH_SURROGATE_START && codeUnit < LOW_SURROGATE_START;
}
function isLowSurrogate(codeUnit) {
	return codeUnit >= LOW_SURROGATE_START && codeUnit <= SURROGATE_END;
}
function isCodePointBoundary(text, index) {
	return !(isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index)));
}
function codePointFrom(text, index) {
	const codeUnit = text.charCodeAt(index);
	const nextCodeUnit = text.charCodeAt(index + 1);
	return isHighSurrogate(codeUnit) && isLowSurrogate(nextCodeUnit) ? FIRST_ASTRAL_CODE_POINT + (codeUnit - HIGH_SURROGATE_START) * SURROGATE_PAYLOAD_SIZE + (nextCodeUnit - LOW_SURROGATE_START) : codeUnit;
}
function codeUnitLength(codePoint) {
	return codePoint < FIRST_ASTRAL_CODE_POINT ? 1 : 2;
}
function codePointLength(text) {
	let length = 0;
	for (let index = 0; index < text.length; index += codeUnitLength(codePointFrom(text, index))) length += 1;
	return length;
}
function compareCodePoints(a, b) {
	let index = 0;
	while (index < a.length && index < b.length) {
		const left = codePointFrom(a, index);
		const right = codePointFrom(b, index);
		if (left !== right) return left - right;
		index += codeUnitLength(left);
	}
	return a.length - b.length;
}
function compareTermRank(a, b) {
	return codePointLength(a) - codePointLength(b) || compareCodePoints(a, b);
}
function countChildrenBefore(children, firstCodePoint) {
	let step = 1;
	while (step * 2 <= children.length) step *= 2;
	let before = 0;
	for (; step > 0; step >>= 1) {
		const candidate = children[before + step - 1];
		if (candidate !== void 0 && codePointFrom(candidate.edge, 0) < firstCodePoint) before += step;
	}
	return before;
}
function sharedPrefixLength(edge, text) {
	let shared = 0;
	while (shared < edge.length && edge.charCodeAt(shared) === text.charCodeAt(shared)) shared += 1;
	return isCodePointBoundary(edge, shared) && isCodePointBoundary(text, shared) ? shared : shared - 1;
}
function splitEdge(parent, position, child, shared) {
	const upper = {
		edge: child.edge.slice(0, shared),
		children: [child],
		value: void 0,
		minTermLength: child.minTermLength
	};
	child.edge = child.edge.slice(shared);
	parent.children.splice(position, 1, upper);
	return upper;
}
function shortestTermLength(node, depth) {
	return node.children.reduce((shortest, child) => Math.min(shortest, child.minTermLength), node.value === void 0 ? Number.POSITIVE_INFINITY : depth);
}
function compressChild(parent, position, child) {
	if (child.value !== void 0 || child.children.length > 1) return;
	const merged = child.children.map((only) => ({
		...only,
		edge: child.edge + only.edge
	}));
	parent.children.splice(position, 1, ...merged);
}
var RadixTree = class {
	rootNode = {
		edge: "",
		children: [],
		value: void 0,
		minTermLength: Number.POSITIVE_INFINITY
	};
	get root() {
		return this.rootNode;
	}
	get(term) {
		let node = this.rootNode;
		let rest = term;
		while (rest !== "") {
			const child = node.children[countChildrenBefore(node.children, codePointFrom(rest, 0))];
			if (child === void 0 || !rest.startsWith(child.edge)) return;
			node = child;
			rest = rest.slice(child.edge.length);
		}
		return node.value;
	}
	set(term, value) {
		const termLength = codePointLength(term);
		let node = this.rootNode;
		let rest = term;
		node.minTermLength = Math.min(node.minTermLength, termLength);
		while (rest !== "") {
			const firstCodePoint = codePointFrom(rest, 0);
			const position = countChildrenBefore(node.children, firstCodePoint);
			const child = node.children[position];
			if (child === void 0 || codePointFrom(child.edge, 0) !== firstCodePoint) {
				node.children.splice(position, 0, {
					edge: rest,
					children: [],
					value,
					minTermLength: termLength
				});
				return;
			}
			const shared = sharedPrefixLength(child.edge, rest);
			node = shared < child.edge.length ? splitEdge(node, position, child, shared) : child;
			node.minTermLength = Math.min(node.minTermLength, termLength);
			rest = rest.slice(shared);
		}
		node.value = value;
	}
	delete(term) {
		const path = [];
		let node = this.rootNode;
		let depth = 0;
		let rest = term;
		while (rest !== "") {
			const position = countChildrenBefore(node.children, codePointFrom(rest, 0));
			const child = node.children[position];
			if (child === void 0 || !rest.startsWith(child.edge)) return false;
			path.push({
				parent: node,
				parentDepth: depth,
				position,
				child
			});
			depth += codePointLength(child.edge);
			node = child;
			rest = rest.slice(child.edge.length);
		}
		if (node.value === void 0) return false;
		node.value = void 0;
		node.minTermLength = shortestTermLength(node, depth);
		for (const { parent, parentDepth, position, child } of path.reverse()) {
			compressChild(parent, position, child);
			parent.minTermLength = shortestTermLength(parent, parentDepth);
		}
		return true;
	}
};

// src/core/expand.ts
const KIND_RANK = {
	exact: 0,
	prefix: 1,
	infix: 2,
	fuzzy: 3
};
const INFIX_GRAM_LENGTH = 3;
const INFIX_SCAN_PER_EXPANSION = 20;
function typoCost(match) {
	return match.distance + (match.firstCharTypo ? 1 : 0);
}
function gramsFrom(codePoints, firstOffset) {
	const grams = /* @__PURE__ */ new Set();
	for (let offset = firstOffset; offset + 3 <= codePoints.length; offset += 1) grams.add(codePoints.slice(offset, offset + 3).join(""));
	return [...grams];
}
function infixGrams(term) {
	return gramsFrom(Array.from(term), 1);
}
function occursAfterFirstCodePoint(text, part) {
	for (let found = text.indexOf(part, 1); found !== -1; found = text.indexOf(part, found + 1)) if (isCodePointBoundary(text, found) && isCodePointBoundary(text, found + part.length)) return true;
	return false;
}
function firstCodePointOf(text) {
	const [first] = text;
	return first;
}
function walkEdge(from, child, queryCodePoints, maxEdits) {
	let row = from.row;
	let closestPrefix = from.closestPrefix;
	for (const codePoint of child.edge) {
		row = nextOsaRow(queryCodePoints, row, codePoint);
		if (row.minimum > maxEdits) break;
		closestPrefix = Math.min(closestPrefix, row.last);
	}
	return {
		node: child,
		pathText: from.pathText + child.edge,
		row,
		closestPrefix
	};
}
function walkWithinEdits(root, queryCodePoints, maxEdits) {
	const reached = [];
	const stopped = [];
	const pending = [{
		node: root,
		pathText: "",
		row: firstOsaRow(queryCodePoints.length),
		closestPrefix: queryCodePoints.length
	}];
	let dpRows = 0;
	for (let from = pending.pop(); from !== void 0; from = pending.pop()) {
		reached.push(from);
		for (const child of from.node.children) {
			const end = walkEdge(from, child, queryCodePoints, maxEdits);
			dpRows += end.row.sourceLength - from.row.sourceLength;
			(end.row.minimum <= maxEdits ? pending : stopped).push(end);
		}
	}
	return {
		reached,
		stopped,
		dpRows
	};
}
function hasFirstCharTypo(queryStart, text, distance) {
	return distance > 0 && firstCodePointOf(text) !== queryStart;
}
function selectableSubtree(queryStart, subtree, pathText, prefixDistance) {
	return {
		key: {
			typoCost: typoCost({
				distance: prefixDistance,
				firstCharTypo: hasFirstCharTypo(queryStart, pathText, prefixDistance)
			}),
			kindRank: KIND_RANK.prefix,
			termLength: subtree.minTermLength,
			text: pathText
		},
		subtree,
		pathText,
		prefixDistance
	};
}
function openSubtree(queryStart, { subtree, pathText, prefixDistance }) {
	const below = subtree.children.map((child) => selectableSubtree(queryStart, child, pathText + child.edge, prefixDistance));
	return subtree.value === void 0 ? below : [selectableTerm(queryStart, subtree.value, "prefix", prefixDistance), ...below];
}
function selectableTerm(queryStart, value, kind, distance) {
	const firstCharTypo = hasFirstCharTypo(queryStart, value.term, distance);
	const expansion = {
		term: value.term,
		value,
		kind,
		distance,
		firstCharTypo
	};
	return {
		key: {
			typoCost: typoCost(expansion),
			kindRank: KIND_RANK[kind],
			termLength: codePointLength(value.term),
			text: value.term
		},
		expansion,
		advancesInfixCursor: false
	};
}
function walkMatch(queryStart, walked, policy) {
	const { value } = walked.node;
	const wholeDistance = walked.row.last;
	if (value === void 0) return [];
	if (wholeDistance === 0) return [selectableTerm(queryStart, value, "exact", 0)];
	if (policy.prefix && walked.closestPrefix <= policy.maxEdits) return [selectableTerm(queryStart, value, "prefix", walked.closestPrefix)];
	return wholeDistance <= policy.maxEdits ? [selectableTerm(queryStart, value, "fuzzy", wholeDistance)] : [];
}
function completionSubtrees(queryStart, walk, policy) {
	if (!policy.prefix) return [];
	return walk.stopped.filter((stop) => stop.closestPrefix <= policy.maxEdits).map((stop) => selectableSubtree(queryStart, stop.node, stop.pathText, stop.closestPrefix));
}
function shortestQueryGramList(grams, queryCodePoints) {
	let shortest;
	for (const gram of gramsFrom(queryCodePoints, 0)) {
		const list = grams.get(gram);
		if (list === void 0) return;
		if (shortest === void 0 || list.size < shortest.size) shortest = list;
	}
	return shortest;
}
function* listedEntries(list) {
	for (const chunk of list?.chunks ?? []) yield* chunk;
}
function compareKeys(a, b) {
	return a.typoCost - b.typoCost || a.kindRank - b.kindRank || a.termLength - b.termLength || compareCodePoints(a.text, b.text);
}
function expandTerm(root, grams, query, policy) {
	const queryCodePoints = Array.from(query);
	const [queryStart] = queryCodePoints;
	const walk = walkWithinEdits(root, queryCodePoints, policy.maxEdits);
	const listed = listedEntries(policy.infix ? shortestQueryGramList(grams, queryCodePoints) : void 0);
	const checkWindow = 20 * policy.maxExpansions;
	let infixChecks = 0;
	const nextInfixMatch = () => {
		while (infixChecks < checkWindow) {
			const read = listed.next();
			if (read.done === true) break;
			infixChecks += 1;
			if (occursAfterFirstCodePoint(read.value.term, query)) return [{
				...selectableTerm(queryStart, read.value, "infix", 0),
				advancesInfixCursor: true
			}];
		}
		return [];
	};
	const heap = new BinaryHeap((a, b) => compareKeys(a.key, b.key));
	const pushAll = (entries) => {
		for (const entry of entries) heap.push(entry);
	};
	for (const walked of walk.reached) pushAll(walkMatch(queryStart, walked, policy));
	pushAll(completionSubtrees(queryStart, walk, policy));
	pushAll(nextInfixMatch());
	const expansions = /* @__PURE__ */ new Map();
	while (expansions.size < policy.maxExpansions) {
		const next = heap.pop();
		if (next === void 0) break;
		if (!("expansion" in next)) {
			pushAll(openSubtree(queryStart, next));
			continue;
		}
		if (!expansions.has(next.expansion.term)) expansions.set(next.expansion.term, next.expansion);
		if (next.advancesInfixCursor) pushAll(nextInfixMatch());
	}
	return {
		expansions: [...expansions.values()],
		dpRows: walk.dpRows,
		infixChecks
	};
}

// src/engine/state.ts
const GRAM_CHUNK_CAPACITY = 512;
const MAX_INFIX_TERM_LENGTH = 64;
const VALUE_BREAK = -1;
const FIELD_BREAK = -2;
const MAX_SURFACE_ID = 2147483647;
const FIRST_BATCH_CODE = -3;
function batchCode(position) {
	return FIRST_BATCH_CODE - position;
}
function batchPosition(code) {
	return FIRST_BATCH_CODE - code;
}
function visitTokenSlots(stream, fieldCount, visit) {
	let fieldIndex = 0;
	for (const [slot, code] of stream.entries()) {
		if (slot < fieldCount || code === -1) continue;
		if (code === -2) fieldIndex += 1;
		else visit(slot, code, fieldIndex);
	}
}
function newSurfaceAt(batch, position) {
	const newSurface = batch.newSurfaces[position];
	if (newSurface === void 0) throw invariantViolation("a stream references a new surface its batch does not hold");
	return newSurface;
}
function createState(config) {
	return {
		config,
		terms: new RadixTree(),
		grams: /* @__PURE__ */ new Map(),
		surfaces: /* @__PURE__ */ new Map(),
		surfacesById: /* @__PURE__ */ new Map(),
		docs: /* @__PURE__ */ new Map(),
		docNumById: /* @__PURE__ */ new Map(),
		lengthSums: config.fields.map(() => 0),
		freeSurfaceIds: [],
		nextDocNum: 0,
		nextSurfaceId: 0
	};
}
function createBatch() {
	return {
		ids: /* @__PURE__ */ new Set(),
		newSurfaceIndex: /* @__PURE__ */ new Map(),
		newSurfaces: [],
		assignedIds: []
	};
}
const HALF_CHUNK_CAPACITY = 512 / 2;
const MIN_MULTI_CHUNK_SIZE = 512 / 4;
function compareEntryRank(a, b) {
	return compareTermRank(a.term, b.term);
}
function ranksBefore(a, b) {
	return compareEntryRank(a, b) < 0;
}
function countBefore(items, isBefore) {
	let low = 0;
	let high = items.length;
	while (low < high) {
		const middle = low + high >>> 1;
		const item = items[middle];
		if (item !== void 0 && isBefore(item)) low = middle + 1;
		else high = middle;
	}
	return low;
}
function mergeByRank(listed, added) {
	const merged = [];
	let addedIndex = 0;
	for (const entry of listed) {
		for (let next = added[addedIndex]; next !== void 0 && ranksBefore(next, entry); next = added[addedIndex]) {
			merged.push(next);
			addedIndex += 1;
		}
		merged.push(entry);
	}
	return merged.concat(added.slice(addedIndex));
}
function cutEvenly(entries) {
	const chunkCount = Math.ceil(entries.length / HALF_CHUNK_CAPACITY);
	const boundary = (chunkIndex) => Math.floor(chunkIndex * entries.length / chunkCount);
	return Array.from({ length: chunkCount }, (_, chunkIndex) => entries.slice(boundary(chunkIndex), boundary(chunkIndex + 1)));
}
function listedGrams(term) {
	return codePointLength(term) > 64 ? [] : infixGrams(term);
}
function groupByGram(entries) {
	const groups = /* @__PURE__ */ new Map();
	for (const entry of entries) for (const gram of listedGrams(entry.term)) {
		const group = groups.get(gram);
		if (group === void 0) groups.set(gram, [entry]);
		else group.push(entry);
	}
	return groups;
}
function positionInList(list, entry) {
	const lastRanksBefore = (chunk) => {
		const last = chunk.at(-1);
		return last !== void 0 && ranksBefore(last, entry);
	};
	const chunkIndex = Math.min(countBefore(list.chunks, lastRanksBefore), list.chunks.length - 1);
	const chunk = list.chunks[chunkIndex];
	if (chunk === void 0) throw invariantViolation("a gram list has no chunk");
	return {
		chunkIndex,
		chunk,
		position: countBefore(chunk, (listed) => ranksBefore(listed, entry))
	};
}
function halves(entries) {
	const middle = entries.length >>> 1;
	return [entries.slice(0, middle), entries.slice(middle)];
}
function insertIntoGramList(list, entry) {
	const { chunkIndex, chunk, position } = positionInList(list, entry);
	chunk.splice(position, 0, entry);
	list.size += 1;
	if (chunk.length > 512) list.chunks.splice(chunkIndex, 1, ...halves(chunk));
}
function addToGramLists(grams, created) {
	for (const [gram, group] of groupByGram(created)) {
		const list = grams.get(gram);
		if (list === void 0 || group.length * 512 >= list.size) {
			const entries = mergeByRank(list?.chunks.flat() ?? [], group.sort(compareEntryRank));
			grams.set(gram, {
				size: entries.length,
				chunks: cutEvenly(entries)
			});
		} else for (const entry of group) insertIntoGramList(list, entry);
	}
}
function mergeWithAdjacentChunk(chunks, chunkIndex) {
	const firstIndex = chunkIndex === chunks.length - 1 ? chunkIndex - 1 : chunkIndex;
	const merged = chunks.slice(firstIndex, firstIndex + 2).flat();
	chunks.splice(firstIndex, 2, ...merged.length > 512 ? halves(merged) : [merged]);
}
function removeFromGramList(grams, gram, entry) {
	const list = grams.get(gram);
	const located = list === void 0 ? void 0 : positionInList(list, entry);
	if (list === void 0 || located?.chunk[located.position] !== entry) throw invariantViolation("a pruned term is missing from its gram list");
	located.chunk.splice(located.position, 1);
	list.size -= 1;
	if (list.size === 0) grams.delete(gram);
	else if (list.chunks.length > 1 && located.chunk.length < MIN_MULTI_CHUNK_SIZE) mergeWithAdjacentChunk(list.chunks, located.chunkIndex);
}
function removeFromGramLists(grams, deleted) {
	for (const entry of deleted) for (const gram of listedGrams(entry.term)) removeFromGramList(grams, gram, entry);
}
function committingTermEntries(terms, created) {
	const touched = /* @__PURE__ */ new Map();
	return (term) => {
		const touchedEntry = touched.get(term);
		if (touchedEntry !== void 0) return touchedEntry;
		let entry = terms.get(term);
		if (entry === void 0) {
			entry = {
				term,
				postings: /* @__PURE__ */ new Map(),
				surfaceIds: []
			};
			terms.set(term, entry);
			created.push(entry);
		}
		touched.set(term, entry);
		return entry;
	};
}
function knownSurface(state, surfaceId) {
	const surface = state.surfacesById.get(surfaceId);
	if (surface === void 0) throw invariantViolation("a stream references an unknown surface id");
	return surface;
}
function allocateSurfaceId(state) {
	const reused = state.freeSurfaceIds.pop();
	if (reused !== void 0) return reused;
	const surfaceId = state.nextSurfaceId;
	if (surfaceId > 2147483647) throw invariantViolation(`a surface id allocation passes MAX_SURFACE_ID ${String(MAX_SURFACE_ID)}`);
	state.nextSurfaceId += 1;
	return surfaceId;
}
function registerSurface(state, batch, position, termEntryOf) {
	const { surface, term } = newSurfaceAt(batch, position);
	const entry = {
		id: allocateSurfaceId(state),
		surface,
		term,
		docCount: 0
	};
	state.surfaces.set(surface, entry);
	state.surfacesById.set(entry.id, entry);
	if (term !== void 0) termEntryOf(term).surfaceIds.push(entry.id);
	batch.assignedIds[position] = entry.id;
	return entry;
}
function committedSurface(state, batch, code, termEntryOf) {
	if (code >= 0) return knownSurface(state, code);
	const position = batchPosition(code);
	const assignedId = batch.assignedIds[position];
	return assignedId === void 0 ? registerSurface(state, batch, position, termEntryOf) : knownSurface(state, assignedId);
}
function addFieldLengths(lengthSums, stream, sign) {
	for (const [fieldIndex, sum] of lengthSums.entries()) lengthSums[fieldIndex] = sum + sign * (stream[fieldIndex] ?? 0);
}
function commitRecord(state, record, docNum, batch, termEntryOf) {
	const fieldCount = state.config.fields.length;
	const { stream } = record;
	const recordSurfaces = /* @__PURE__ */ new Set();
	visitTokenSlots(stream, fieldCount, (slot, code, fieldIndex) => {
		const surface = committedSurface(state, batch, code, termEntryOf);
		stream[slot] = surface.id;
		recordSurfaces.add(surface);
		if (surface.term !== void 0) {
			const { postings } = termEntryOf(surface.term);
			const key = docNum * fieldCount + fieldIndex;
			postings.set(key, (postings.get(key) ?? 0) + 1);
		}
	});
	for (const surface of recordSurfaces) surface.docCount += 1;
	addFieldLengths(state.lengthSums, stream, 1);
	state.docs.set(docNum, {
		id: record.id,
		item: record.item,
		stream
	});
	state.docNumById.set(record.id, docNum);
}
function commitRecords(state, records, firstDocNum, batch) {
	const created = [];
	const termEntryOf = committingTermEntries(state.terms, created);
	for (const [offset, record] of records.entries()) commitRecord(state, record, firstDocNum + offset, batch, termEntryOf);
	state.nextDocNum = Math.max(state.nextDocNum, firstDocNum + records.length);
	addToGramLists(state.grams, created);
}
function existingTermEntry(terms, term) {
	const entry = terms.get(term);
	if (entry === void 0) throw invariantViolation("a surface refers to a term the vocabulary does not hold");
	return entry;
}
function removeSurfaceId(entry, surfaceId) {
	const position = entry.surfaceIds.indexOf(surfaceId);
	if (position === -1) throw invariantViolation("a pruned surface is missing from its term");
	entry.surfaceIds.splice(position, 1);
}
function retractRecord(state, docNum) {
	const doc = state.docs.get(docNum);
	if (doc === void 0) throw invariantViolation("a retracted docNum is not indexed");
	const fieldCount = state.config.fields.length;
	const retracted = /* @__PURE__ */ new Set();
	visitTokenSlots(doc.stream, fieldCount, (_, surfaceId, fieldIndex) => {
		const { term } = knownSurface(state, surfaceId);
		retracted.add(surfaceId);
		if (term !== void 0) existingTermEntry(state.terms, term).postings.delete(docNum * fieldCount + fieldIndex);
	});
	for (const surfaceId of retracted) knownSurface(state, surfaceId).docCount -= 1;
	addFieldLengths(state.lengthSums, doc.stream, -1);
	return retracted;
}
function pruneSurfaces(state, surfaceIds) {
	const deleted = [];
	for (const surfaceId of surfaceIds) {
		const { surface, term, docCount } = knownSurface(state, surfaceId);
		if (docCount > 0) continue;
		state.surfaces.delete(surface);
		state.surfacesById.delete(surfaceId);
		state.freeSurfaceIds.push(surfaceId);
		if (term !== void 0) {
			const entry = existingTermEntry(state.terms, term);
			removeSurfaceId(entry, surfaceId);
			if (entry.surfaceIds.length === 0) {
				state.terms.delete(term);
				deleted.push(entry);
			}
		}
	}
	removeFromGramLists(state.grams, deleted);
}
function indexedDoc(state, docNum) {
	const doc = state.docs.get(docNum);
	if (doc === void 0) throw invariantViolation("a posting or a ranked record refers to a docNum that is not indexed");
	return doc;
}
function* valueRuns(stream, fields) {
	let start = fields.length;
	for (const [fieldIndex, field] of fields.entries()) {
		let valueIndex = 0;
		let end = start;
		for (; end < stream.length && stream[end] !== -2; end += 1) if (stream[end] === -1) {
			yield {
				field,
				fieldIndex,
				valueIndex,
				slots: stream.subarray(start, end)
			};
			valueIndex += 1;
			start = end + 1;
		}
		yield {
			field,
			fieldIndex,
			valueIndex,
			slots: stream.subarray(start, end)
		};
		start = end + 1;
	}
}
function averageFieldLength(state, fieldIndex) {
	const lengthSum = state.lengthSums[fieldIndex];
	if (lengthSum === void 0) throw invariantViolation("a field index is outside the key paths");
	return state.docs.size === 0 ? 0 : lengthSum / state.docs.size;
}

// src/engine/prepare.ts
const ITEM_KIND_RULES = {
	string: "items must all be strings",
	object: "items must all be non-null, non-array objects"
};
function recordRejection(code, message, recordIndex) {
	return new TyposeekError(code, message, recordIndex === void 0 ? void 0 : { recordIndex });
}
function addNewSurface(pipeline, batch, surface) {
	const position = batch.newSurfaces.length;
	batch.newSurfaces.push({
		surface,
		term: processSurface(pipeline, surface)
	});
	batch.newSurfaceIndex.set(surface, position);
	return position;
}
function surfaceSlot(state, batch, surface) {
	const known = state.surfaces.get(surface);
	if (known !== void 0) return {
		code: known.id,
		term: known.term
	};
	const position = batch.newSurfaceIndex.get(surface) ?? addNewSurface(state.config.pipeline, batch, surface);
	return {
		code: batchCode(position),
		term: newSurfaceAt(batch, position).term
	};
}
function buildStream(state, item, batch) {
	const { fields, pipeline } = state.config;
	const fieldLengths = [];
	const tokenSlots = [];
	for (const [fieldIndex, field] of fields.entries()) {
		if (fieldIndex > 0) tokenSlots.push(-2);
		let fieldLength = 0;
		for (const [valueIndex, value] of resolveText(item, field.segments).entries()) {
			if (valueIndex > 0) tokenSlots.push(-1);
			for (const span of validateSpans(pipeline.tokenize(value), value.length)) {
				const slot = surfaceSlot(state, batch, value.slice(span.start, span.end));
				tokenSlots.push(slot.code);
				fieldLength += slot.term === void 0 ? 0 : 1;
			}
		}
		fieldLengths.push(fieldLength);
	}
	const stream = new Int32Array(fieldLengths.length + tokenSlots.length);
	stream.set(fieldLengths);
	stream.set(tokenSlots, fieldLengths.length);
	return stream;
}
function recordId(record, idKey, recordIndex) {
	if (!isObjectRecord(record)) throw recordRejection("INVALID_RECORD", "record must be a non-null, non-array object", recordIndex);
	const id = Object.hasOwn(record, idKey) ? record[idKey] : void 0;
	if (!isValidId(id)) throw recordRejection("INVALID_ID", "the own property at idKey must be a non-empty string other than __proto__, constructor and prototype, or a finite number", recordIndex);
	return id;
}
function prepareRecord(state, record, recordIndex, batch, mode) {
	const id = recordId(record, state.config.idKey, recordIndex);
	const indexed = state.docNumById.has(id);
	if (mode === "add" && (indexed || batch.ids.has(id))) throw recordRejection("DUPLICATE_ID", "add needs an id that is neither indexed nor earlier in the batch", recordIndex);
	if (mode === "update" && !indexed) throw recordRejection("UNKNOWN_ID", "update needs an indexed id", recordIndex);
	batch.ids.add(id);
	return {
		id,
		item: record,
		stream: buildStream(state, record, batch)
	};
}
function isItemOfKind(item, itemKind) {
	return itemKind === "string" ? typeof item === "string" : isObjectRecord(item);
}
function prepareArrayItem(state, item, position, itemKind, batch) {
	if (!isItemOfKind(item, itemKind)) throw recordRejection("INVALID_RECORD", ITEM_KIND_RULES[itemKind], position);
	return {
		id: position,
		item,
		stream: buildStream(state, item, batch)
	};
}
function checkedOutput(output, hook) {
	if (typeof output !== "string") throw new TyposeekError("INVALID_PIPELINE_OUTPUT", `${hook} must return a string`);
	return output;
}
function normalizedStopTerms(normalize, words) {
	const stopTerms = /* @__PURE__ */ new Set();
	for (const word of words) {
		const stopTerm = checkedOutput(normalize(word), "normalize");
		if (stopTerm !== "") stopTerms.add(stopTerm);
	}
	return stopTerms;
}
function createPipeline(hooks, stop) {
	const normalize = hooks.normalize ?? foldTerm;
	return Object.freeze({
		tokenize: hooks.tokenize ?? tokenize,
		normalize,
		stem: hooks.stem,
		stopTerms: stop.kind === "terms" ? new Set(stop.terms) : normalizedStopTerms(normalize, stop.words)
	});
}
function processSurface(pipeline, surface) {
	const normalized = checkedOutput(pipeline.normalize(surface), "normalize");
	if (normalized === "" || pipeline.stopTerms.has(normalized)) return;
	if (pipeline.stem === void 0) return normalized;
	const stemmed = checkedOutput(pipeline.stem(normalized), "stem");
	return stemmed === "" ? void 0 : stemmed;
}
function isValidId(value) {
	if (typeof value === "string") return value !== "" && !isForbiddenPropertyName(value);
	return typeof value === "number" && Number.isFinite(value);
}

// src/core/query.ts
const WHITESPACE = /\s/u;
const NEGATION_MARKS = /* @__PURE__ */ new Set(["-", "−"]);
const PHRASE_QUOTES = /* @__PURE__ */ new Set([
	"\"",
	"“",
	"”",
	"„",
	"‟",
	"«",
	"»"
]);
function isWhitespace(character) {
	return WHITESPACE.test(character);
}
function isPhraseQuote(character) {
	return PHRASE_QUOTES.has(character);
}
function scanPhrase(query, textStart) {
	let end = textStart;
	while (end < query.length && !isPhraseQuote(query.charAt(end))) end += 1;
	return {
		kind: "phrase",
		text: query.slice(textStart, end),
		next: end + 1
	};
}
function scanTerm(query, start) {
	let end = start;
	while (end < query.length && !isWhitespace(query.charAt(end)) && !isPhraseQuote(query.charAt(end))) end += 1;
	return {
		kind: "term",
		text: query.slice(start, end),
		next: end
	};
}
function scanClause(query, start) {
	return isPhraseQuote(query.charAt(start)) ? scanPhrase(query, start + 1) : scanTerm(query, start);
}
function parseQuery(query) {
	const clauses = [];
	let cursor = 0;
	while (cursor < query.length) {
		const character = query.charAt(cursor);
		if (isWhitespace(character)) {
			cursor += 1;
			continue;
		}
		const negated = NEGATION_MARKS.has(character);
		const { kind, text, next } = scanClause(query, negated ? cursor + 1 : cursor);
		if (text !== "") clauses.push({
			kind,
			negated,
			text
		});
		cursor = next;
	}
	return clauses;
}

// src/core/rank.ts
const BM25_K1 = 1.2;
const BM25_B = .75;
function idf(recordCount, documentFrequency) {
	return Math.log(1 + (recordCount - documentFrequency + .5) / (documentFrequency + .5));
}
function weightedFieldFrequency(tf, fieldLength, averageFieldLength, weight) {
	return weight * tf / (.25 + BM25_B * fieldLength / averageFieldLength);
}
function termContribution(weightedFrequency) {
	return weightedFrequency * 2.2 / (weightedFrequency + BM25_K1);
}
function compareRelevance(a, b) {
	return b.matchedClauses - a.matchedClauses || a.typoCost - b.typoCost || a.infixMatches - b.infixMatches || a.prefixMatches - b.prefixMatches || b.score - a.score || a.docNum - b.docNum;
}

// src/core/top-k.ts
function selectPage(entries, compare, offset, limit) {
	const windowSize = offset + limit;
	const window = new BinaryHeap((a, b) => compare(b, a));
	let total = 0;
	for (const entry of entries) {
		total += 1;
		const worstKept = window.peek();
		if (window.size < windowSize) window.push(entry);
		else if (worstKept !== void 0 && compare(entry, worstKept) < 0) {
			window.pop();
			window.push(entry);
		}
	}
	const worstFirst = [];
	for (let entry = window.pop(); entry !== void 0; entry = window.pop()) worstFirst.push(entry);
	return {
		total,
		page: worstFirst.reverse().slice(offset)
	};
}

// src/engine/execute.ts
const SURFACE_MATCHES_UNDER_KIND = {
	exact: (querySurface, surface) => surface === querySurface,
	prefix: (querySurface, surface, maxEdits) => boundedPrefixDistance(querySurface, surface, maxEdits) !== void 0,
	infix: (querySurface, surface) => occursAfterFirstCodePoint(surface, querySurface),
	fuzzy: (querySurface, surface, maxEdits) => boundedOsaDistance(querySurface, surface, maxEdits) !== void 0
};
const PHRASE_HIT_KIND = "exact";
function composed(text) {
	return text.normalize("NFC");
}
function tokenizeClauses(pipeline, clauses) {
	return clauses.flatMap((clause) => validateSpans(pipeline.tokenize(clause.text), clause.text.length).map((span) => ({
		clause,
		surface: clause.text.slice(span.start, span.end)
	})));
}
function processTokensByClause(pipeline, tokens) {
	const lastToken = tokens.at(-1);
	const byClause = /* @__PURE__ */ new Map();
	for (const token of tokens) {
		const processed = {
			surface: token.surface,
			term: processSurface(pipeline, token.surface),
			isLast: token === lastToken
		};
		const group = byClause.get(token.clause);
		if (group === void 0) byClause.set(token.clause, [processed]);
		else group.push(processed);
	}
	return byClause;
}
function isTermToken(token) {
	return token.term !== void 0;
}
function termClausesOf(clause, tokens) {
	const exact = clause.negated || clause.kind === "phrase";
	return tokens.map((token) => ({
		surface: token.surface,
		term: token.term,
		exact,
		isLast: token.isLast && !exact
	}));
}
function mergeDuplicates(clauses, fold) {
	const merged = /* @__PURE__ */ new Map();
	for (const clause of clauses) {
		const key = JSON.stringify([
			clause.exact,
			clause.term,
			fold ? "" : composed(clause.surface)
		]);
		const earlier = merged.get(key);
		merged.set(key, earlier === void 0 ? clause : {
			...earlier,
			isLast: earlier.isLast || clause.isLast
		});
	}
	return [...merged.values()];
}
function planQuery(byClause, fold) {
	const positiveTerms = [];
	const positivePhrases = [];
	const negatedTerms = [];
	const negatedPhrases = [];
	for (const [clause, tokens] of byClause) {
		const termTokens = tokens.filter(isTermToken);
		if (clause.kind === "phrase" && termTokens.length > 1) (clause.negated ? negatedPhrases : positivePhrases).push({ tokens });
		else (clause.negated ? negatedTerms : positiveTerms).push(...termClausesOf(clause, termTokens));
	}
	return {
		positiveTerms: mergeDuplicates(positiveTerms, fold),
		positivePhrases,
		negatedTerms,
		negatedPhrases
	};
}
function queryPlan(state, query, options) {
	const { pipeline, limits } = state.config;
	const { truncateQuery } = options;
	const clauses = parseQuery(capQueryLength(query, limits.maxQueryLength, truncateQuery));
	return planQuery(processTokensByClause(pipeline, capTerms(tokenizeClauses(pipeline, clauses), limits.maxQueryTerms, truncateQuery)), options.fold);
}
function searchContext(state, options) {
	const { fields } = state.config;
	return {
		state,
		options,
		fields,
		scales: fields.map((field, fieldIndex) => ({
			weight: field.weight,
			averageLength: averageFieldLength(state, fieldIndex)
		}))
	};
}
function keptSurfaces(state, entry, matches) {
	return new Set(entry.surfaceIds.filter((surfaceId) => matches(composed(knownSurface(state, surfaceId).surface))));
}
function expandClause(context, clause) {
	const { state, options } = context;
	const { typos } = options;
	const maxEdits = clause.exact || typos === false ? 0 : typoLimit(codePointLength(clause.term), typos);
	const { expansions } = expandTerm(state.terms.root, state.grams, clause.term, {
		maxEdits,
		prefix: clause.isLast && options.prefix,
		infix: clause.isLast && options.infix,
		maxExpansions: state.config.limits.maxExpansions
	});
	if (options.fold) return expansions.map((expansion) => ({
		expansion,
		entry: expansion.value,
		kept: void 0
	}));
	const querySurface = composed(clause.surface);
	return expansions.flatMap((expansion) => {
		const matchesUnderKind = SURFACE_MATCHES_UNDER_KIND[expansion.kind];
		const kept = keptSurfaces(state, expansion.value, (surface) => matchesUnderKind(querySurface, surface, maxEdits));
		return kept.size === 0 ? [] : [{
			expansion,
			entry: expansion.value,
			kept
		}];
	});
}
function postedDocNums(entry, fieldCount) {
	const docNums = /* @__PURE__ */ new Set();
	for (const key of entry.postings.keys()) docNums.add(Math.floor(key / fieldCount));
	return docNums;
}
function docNumsHolding(context, matched) {
	const fieldCount = context.fields.length;
	const docNums = [...postedDocNums(matched.entry, fieldCount)];
	const { kept } = matched;
	if (kept === void 0) return docNums;
	return docNums.filter((docNum) => indexedDoc(context.state, docNum).stream.subarray(fieldCount).some((surfaceId) => kept.has(surfaceId)));
}
function fieldWeight(context, stream, fieldIndex, tf) {
	const scale = context.scales[fieldIndex];
	const fieldLength = stream[fieldIndex];
	if (scale === void 0 || fieldLength === void 0) throw invariantViolation("a field index is outside the key paths");
	return weightedFieldFrequency(tf, fieldLength, scale.averageLength, scale.weight);
}
function postedWeightedFrequency(context, docNum, stream, entry) {
	let weighted = 0;
	for (const fieldIndex of context.fields.keys()) {
		const tf = entry.postings.get(docNum * context.fields.length + fieldIndex);
		if (tf !== void 0) weighted += fieldWeight(context, stream, fieldIndex, tf);
	}
	return weighted;
}
function keptWeightedFrequency(context, stream, kept) {
	let weighted = 0;
	for (const { fieldIndex, slots } of valueRuns(stream, context.fields)) {
		const tf = slots.filter((surfaceId) => kept.has(surfaceId)).length;
		if (tf > 0) weighted += fieldWeight(context, stream, fieldIndex, tf);
	}
	return weighted;
}
function weightedFrequency(context, docNum, matched) {
	const { stream } = indexedDoc(context.state, docNum);
	return matched.kept === void 0 ? postedWeightedFrequency(context, docNum, stream, matched.entry) : keptWeightedFrequency(context, stream, matched.kept);
}
function compareTermHits(a, b) {
	return a.typoCost - b.typoCost || KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.contribution - a.contribution || compareCodePoints(a.term, b.term);
}
function termClauseMatch(context, clause) {
	const matches = expandClause(context, clause);
	const hits = /* @__PURE__ */ new Map();
	for (const match of matches) for (const docNum of docNumsHolding(context, match)) {
		const hit = {
			typoCost: typoCost(match.expansion),
			kind: match.expansion.kind,
			contribution: termContribution(weightedFrequency(context, docNum, match)),
			term: match.expansion.term
		};
		const best = hits.get(docNum);
		if (best === void 0 || compareTermHits(hit, best) < 0) hits.set(docNum, hit);
	}
	return {
		hits,
		terms: matches
	};
}
function negatedTermDocNums(context, clause) {
	return expandClause(context, clause).flatMap((match) => docNumsHolding(context, match));
}
function phrasePositions(context, phrase) {
	const positions = [];
	for (const token of phrase.tokens) {
		if (!isTermToken(token)) {
			positions.push(void 0);
			continue;
		}
		const [match] = expandClause(context, {
			surface: token.surface,
			term: token.term,
			exact: true,
			isLast: false
		});
		if (match === void 0) return;
		positions.push({
			entry: match.entry,
			kept: match.kept,
			qualifying: match.kept ?? new Set(match.entry.surfaceIds)
		});
	}
	return positions;
}
function hasPosting(entry, docNum, fieldCount) {
	for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) if (entry.postings.has(docNum * fieldCount + fieldIndex)) return true;
	return false;
}
function qualifies(position, surfaceId) {
	return position === void 0 || position.qualifying.has(surfaceId);
}
function holdsSequence(stream, fields, positions) {
	for (const { slots } of valueRuns(stream, fields)) for (let start = 0; start + positions.length <= slots.length; start += 1) if (slots.subarray(start, start + positions.length).every((surfaceId, offset) => qualifies(positions[offset], surfaceId))) return true;
	return false;
}
function isPhraseTerm(position) {
	return position !== void 0;
}
function phraseDocNums(context, positions) {
	const { state, fields } = context;
	const terms = positions.filter(isPhraseTerm);
	return [...postedDocNums(terms.reduce((rarer, term) => term.entry.postings.size < rarer.entry.postings.size ? term : rarer).entry, fields.length)].filter((docNum) => terms.every((term) => hasPosting(term.entry, docNum, fields.length)) && holdsSequence(indexedDoc(state, docNum).stream, fields, positions));
}
function phraseMatch(context, phrase) {
	const positions = phrasePositions(context, phrase);
	if (positions === void 0) return {
		hits: /* @__PURE__ */ new Map(),
		terms: []
	};
	const terms = positions.filter(isPhraseTerm);
	const hits = /* @__PURE__ */ new Map();
	for (const docNum of phraseDocNums(context, positions)) {
		const contribution = terms.reduce((sum, term) => sum + termContribution(weightedFrequency(context, docNum, term)), 0);
		hits.set(docNum, {
			typoCost: 0,
			kind: PHRASE_HIT_KIND,
			contribution
		});
	}
	return {
		hits,
		terms
	};
}
function negatedPhraseDocNums(context, phrase) {
	const positions = phrasePositions(context, phrase);
	return positions === void 0 ? [] : phraseDocNums(context, positions);
}
function excludedDocNums(context, plan) {
	return /* @__PURE__ */ new Set([...plan.negatedTerms.flatMap((clause) => negatedTermDocNums(context, clause)), ...plan.negatedPhrases.flatMap((phrase) => negatedPhraseDocNums(context, phrase))]);
}
function withIdf(context, clauses) {
	const recordCount = context.state.docs.size;
	return clauses.map((clause) => ({
		...clause,
		idf: idf(recordCount, clause.hits.size)
	}));
}
function combine(positives, mode) {
	if (mode === "or") return [...new Set(positives.flatMap(({ hits }) => [...hits.keys()]))];
	return [...positives.reduce((rarer, clause) => clause.hits.size < rarer.hits.size ? clause : rarer).hits.keys()].filter((docNum) => positives.every(({ hits }) => hits.has(docNum)));
}
function rankKey(docNum, positives) {
	let matchedClauses = 0;
	let totalTypoCost = 0;
	let infixMatches = 0;
	let prefixMatches = 0;
	let score = 0;
	for (const clause of positives) {
		const hit = clause.hits.get(docNum);
		if (hit !== void 0) {
			matchedClauses += 1;
			totalTypoCost += hit.typoCost;
			infixMatches += Number(hit.kind === "infix");
			prefixMatches += Number(hit.kind === "prefix");
			score += clause.idf * hit.contribution;
		}
	}
	return {
		matchedClauses,
		typoCost: totalTypoCost,
		infixMatches,
		prefixMatches,
		score,
		docNum
	};
}
function recordMarks(terms, fold) {
	const keptSurfaceIds = new Set(terms.flatMap(({ kept }) => [...kept ?? []]));
	return {
		terms: new Set(terms.map(({ entry }) => entry.term)),
		surfaceIds: fold ? void 0 : keptSurfaceIds
	};
}
function rankedRecord(docNum, marks) {
	const phraseTerms = marks.phrases.filter(({ hits }) => hits.has(docNum)).flatMap(({ terms }) => terms);
	const { terms, surfaceIds } = phraseTerms.length === 0 ? marks.termClauseMarks : recordMarks([...marks.termClauseTerms, ...phraseTerms], marks.fold);
	return {
		docNum,
		matchedTerms: terms,
		matchedSurfaceIds: surfaceIds
	};
}
function docNumsInOrder(state, offset, limit) {
	const page = [];
	let position = 0;
	for (const docNum of state.docs.keys()) {
		if (position >= offset + limit) break;
		if (position >= offset) page.push(docNum);
		position += 1;
	}
	return page;
}
function docNumPage(selected) {
	return {
		total: selected.total,
		page: selected.page.map((entry) => entry.docNum)
	};
}
function orderedPage(context, candidates, positives) {
	const { offset, limit, sortBy } = context.options;
	if (sortBy === void 0) {
		const keys = candidates.map((docNum) => rankKey(docNum, positives));
		return docNumPage(selectPage(keys, compareRelevance, offset, limit));
	}
	const keyed = candidates.map((docNum) => ({
		docNum,
		sortKey: sortBy.keyOf(indexedDoc(context.state, docNum).item)
	}));
	const compareSorted = (a, b) => sortBy.compare(a.sortKey, b.sortKey) || a.docNum - b.docNum;
	return docNumPage(selectPage(keyed, compareSorted, offset, limit));
}
function isListedInOrder(positives, excluded, options) {
	return positives.length === 0 && excluded.size === 0 && options.filter === void 0 && options.sortBy === void 0;
}
function executeSearch(state, query, options) {
	const plan = queryPlan(state, query, options);
	const context = searchContext(state, options);
	const termMatches = plan.positiveTerms.map((clause) => termClauseMatch(context, clause));
	const phraseMatches = plan.positivePhrases.map((phrase) => phraseMatch(context, phrase));
	const positives = withIdf(context, [...termMatches, ...phraseMatches]);
	const termClauseTerms = termMatches.flatMap(({ terms }) => terms);
	const marks = {
		termClauseTerms,
		termClauseMarks: recordMarks(termClauseTerms, options.fold),
		phrases: phraseMatches,
		fold: options.fold
	};
	const excluded = excludedDocNums(context, plan);
	const toRanked = (docNum) => rankedRecord(docNum, marks);
	if (isListedInOrder(positives, excluded, options)) return {
		total: state.docs.size,
		page: docNumsInOrder(state, options.offset, options.limit).map(toRanked)
	};
	const { filter } = options;
	const { total, page } = orderedPage(context, (positives.length === 0 ? [...state.docs.keys()] : combine(positives, options.mode)).filter((docNum) => !excluded.has(docNum) && (filter === void 0 || filter(indexedDoc(state, docNum).item))), positives);
	return {
		total,
		page: page.map(toRanked)
	};
}

// src/engine/highlight.ts
const CHANGED_VALUE_PROBLEM = "a highlighted value no longer holds the tokens it was indexed with; either the tokenizer is impure, or the record changed after indexing without update";
function indexedSpans(state, value, slots) {
	if (value === void 0) throw invariantViolation(CHANGED_VALUE_PROBLEM);
	const spans = validateSpans(state.config.pipeline.tokenize(value), value.length);
	const surfaces = Array.from(slots, (surfaceId) => knownSurface(state, surfaceId).surface);
	if (!(spans.length === surfaces.length && spans.every((span, position) => value.slice(span.start, span.end) === surfaces[position]))) throw invariantViolation(CHANGED_VALUE_PROBLEM);
	return spans;
}
function matchPredicate(state, ranked) {
	const { matchedTerms, matchedSurfaceIds } = ranked;
	if (matchedSurfaceIds !== void 0) return (surfaceId) => matchedSurfaceIds.has(surfaceId);
	return (surfaceId) => {
		const { term } = knownSurface(state, surfaceId);
		return term !== void 0 && matchedTerms.has(term);
	};
}
function highlightRecord(state, ranked) {
	const { fields } = state.config;
	const { item, stream } = indexedDoc(state, ranked.docNum);
	const isMatched = matchPredicate(state, ranked);
	const matches = [];
	let resolvedFieldIndex = -1;
	let values = [];
	for (const run of valueRuns(stream, fields)) {
		const matchedSlots = Array.from(run.slots, isMatched);
		if (!matchedSlots.includes(true)) continue;
		if (run.fieldIndex !== resolvedFieldIndex) {
			values = resolveText(item, run.field.segments);
			resolvedFieldIndex = run.fieldIndex;
		}
		const ranges = indexedSpans(state, values[run.valueIndex], run.slots).filter((_, position) => matchedSlots[position] === true).map((span) => [span.start, span.end]);
		matches.push({
			key: run.field.path,
			valueIndex: run.valueIndex,
			ranges
		});
	}
	return matches;
}

// src/engine/respond.ts
function checkedQuery(query) {
	if (typeof query !== "string") throw new TyposeekError("INVALID_OPTION", "query must be a string");
	return query;
}
function searchResponse(state, query, options, hitOf) {
	const { total, page } = executeSearch(state, query, options);
	return {
		total,
		hits: page.map((ranked) => hitOf(indexedDoc(state, ranked.docNum), ranked.docNum, highlightRecord(state, ranked)))
	};
}

// src/engine/snapshot.ts
function toSnapshot(state) {
	const { idKey, fields, limits, pipeline } = state.config;
	const surfaces = [];
	const surfaceIndexById = /* @__PURE__ */ new Map();
	const surfaceIndexOf = (surfaceId) => {
		const listed = surfaceIndexById.get(surfaceId);
		if (listed !== void 0) return listed;
		const { surface, term } = knownSurface(state, surfaceId);
		surfaceIndexById.set(surfaceId, surfaces.length);
		surfaces.push([surface, term ?? null]);
		return surfaces.length - 1;
	};
	const snapshotSlot = (slot, position) => position < fields.length || slot < 0 ? slot : surfaceIndexOf(slot);
	const records = Array.from(state.docs.values(), ({ item, stream }) => [item, Array.from(stream, snapshotSlot)]);
	return {
		format: "typoseek-index",
		version: 1,
		idKey,
		keys: fields.map(({ path, weight }) => ({
			path,
			weight
		})),
		limits: { ...limits },
		stopTerms: [...pipeline.stopTerms].sort(compareCodePoints),
		surfaces,
		records
	};
}

// src/engine/create-index.ts
const SLICE_BUDGET_MS = 10;
function invalidOption(problem) {
	return new TyposeekError("INVALID_OPTION", problem);
}
function checkedRecords(records) {
	if (!isArray(records)) throw invalidOption("records must be an array");
	return records;
}
function abortSource(options) {
	if (options === void 0) return;
	if (!isObjectRecord(options)) throw invalidOption("options must be an object");
	const { signal } = options;
	if (signal === void 0 || isObjectRecord(signal)) return signal;
	throw invalidOption("signal must be an object with an aborted property");
}
function abortError(signal) {
	return signal?.aborted === true ? new TyposeekError("ABORTED", "addAllAsync was aborted", { cause: signal.reason }) : void 0;
}
function throwIfAborted(signal) {
	const error = abortError(signal);
	if (error !== void 0) throw error;
}
function removalDocNum(state, id) {
	if (!isValidId(id)) throw new TyposeekError("INVALID_ID", "id must be a non-empty string other than __proto__, constructor and prototype, or a finite number");
	const docNum = state.docNumById.get(id);
	if (docNum === void 0) throw new TyposeekError("UNKNOWN_ID", "remove needs an indexed id");
	return docNum;
}
function indexedDocNum(state, id) {
	const docNum = state.docNumById.get(id);
	if (docNum === void 0) throw invariantViolation("a prepared update refers to an id that is not indexed");
	return docNum;
}
function addRecords(state, records) {
	const batch = createBatch();
	const prepared = Array.from(records, (record, recordIndex) => prepareRecord(state, record, recordIndex, batch, "add"));
	commitRecords(state, prepared, state.nextDocNum, batch);
}
function updateRecord(state, record) {
	const batch = createBatch();
	const prepared = prepareRecord(state, record, void 0, batch, "update");
	const docNum = indexedDocNum(state, prepared.id);
	const retracted = retractRecord(state, docNum);
	commitRecords(state, [prepared], docNum, batch);
	pruneSurfaces(state, retracted);
}
function withdrawDoc(state, docNum) {
	const { id } = indexedDoc(state, docNum);
	const retracted = retractRecord(state, docNum);
	state.docs.delete(docNum);
	state.docNumById.delete(id);
	return retracted;
}
function nextTurn() {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve();
		}, 0);
	});
}
function runSlice(from, to, step) {
	const sliceEnd = Date.now() + 10;
	let position = from;
	do {
		step(position);
		position += 1;
	} while (position < to && Date.now() <= sliceEnd);
	return position;
}
async function prepareInSlices(state, records, signal) {
	const batch = createBatch();
	const prepared = [];
	const sliceEnds = [];
	while (prepared.length < records.length) {
		const sliceEnd = runSlice(prepared.length, records.length, (recordIndex) => {
			prepared.push(prepareRecord(state, records[recordIndex], recordIndex, batch, "add"));
		});
		sliceEnds.push(sliceEnd);
		await nextTurn();
		throwIfAborted(signal);
	}
	return {
		batch,
		prepared,
		sliceEnds
	};
}
async function rollBack(state, firstDocNum) {
	const endDocNum = state.nextDocNum;
	let next = firstDocNum;
	while (next < endDocNum) {
		const retracted = /* @__PURE__ */ new Set();
		next = runSlice(next, endDocNum, (docNum) => {
			for (const surfaceId of withdrawDoc(state, docNum)) retracted.add(surfaceId);
		});
		pruneSurfaces(state, retracted);
		if (next < endDocNum) await nextTurn();
	}
}
async function commitInSlices(state, run, signal) {
	const firstDocNum = state.nextDocNum;
	let sliceStart = 0;
	for (const sliceEnd of run.sliceEnds) {
		if (sliceStart > 0) {
			await nextTurn();
			const error = abortError(signal);
			if (error !== void 0) {
				await rollBack(state, firstDocNum);
				throw error;
			}
		}
		commitRecords(state, run.prepared.slice(sliceStart, sliceEnd), state.nextDocNum, run.batch);
		sliceStart = sliceEnd;
	}
}
async function addRecordsAsync(state, records, signal) {
	throwIfAborted(signal);
	await commitInSlices(state, await prepareInSlices(state, records, signal), signal);
}
function indexFromState(state) {
	let busy = false;
	const assertIdle = () => {
		if (busy) throw new TyposeekError("INDEX_BUSY", "the index cannot change while addAllAsync runs");
	};
	const addAll = (records) => {
		assertIdle();
		addRecords(state, checkedRecords(records));
	};
	return Object.freeze({
		get size() {
			return state.docs.size;
		},
		has: (id) => state.docNumById.has(id),
		add: (record) => {
			addAll([record]);
		},
		addAll,
		addAllAsync: async (records, options) => {
			assertIdle();
			const pending = Array.from(checkedRecords(records));
			const signal = abortSource(options);
			busy = true;
			try {
				await addRecordsAsync(state, pending, signal);
			} finally {
				busy = false;
			}
		},
		update: (record) => {
			assertIdle();
			updateRecord(state, record);
		},
		remove: (id) => {
			assertIdle();
			pruneSurfaces(state, withdrawDoc(state, removalDocNum(state, id)));
		},
		search: (query, options) => searchResponse(state, checkedQuery(query), resolveSearchOptions(options), (doc, _, matches) => ({
			id: doc.id,
			item: doc.item,
			matches
		})),
		toJSON: () => {
			assertIdle();
			return toSnapshot(state);
		}
	});
}
/** @public */
function createIndex(options) {
	const { hooks, stopWords } = resolvePipelineOptions(options);
	const idKey = resolveIdKey(options.idKey);
	const fields = resolveKeySpecs(options.keys);
	const limits = resolveLimits(options.limits);
	const pipeline = createPipeline(hooks, {
		kind: "words",
		words: stopWords
	});
	return indexFromState(createState({
		fields,
		idKey,
		pipeline,
		limits
	}));
}

export { validateSpans as A, resolvePipelineOptions as C, resolveMeteredText as D, isObjectRecord as E, isIterableObject as O, resolveLoadOptions as S, isArray as T, checkKeySpecs as _, createPipeline as a, resolveKeySpecs as b, batchCode as c, createBatch as d, createState as f, SELF_FIELD as g, DEFAULT_LIMITS as h, searchResponse as i, foldTerm as j, tokenize as k, batchPosition as l, valueRuns as m, indexFromState as n, isValidId as o, newSurfaceAt as p, checkedQuery as r, prepareArrayItem as s, createIndex as t, commitRecords as u, checkLimits as v, resolveSearchOptions as w, resolveLimits as x, isValidIdKey as y };