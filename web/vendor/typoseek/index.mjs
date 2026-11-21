import { r as isTyposeekError, t as TyposeekError } from "./errors-DcnmNX-E.mjs";
import { C as resolvePipelineOptions, T as isArray, a as createPipeline, b as resolveKeySpecs, d as createBatch, f as createState, g as SELF_FIELD, i as searchResponse, j as foldTerm, k as tokenize, r as checkedQuery, s as prepareArrayItem, t as createIndex, u as commitRecords, w as resolveSearchOptions, x as resolveLimits } from "./create-index-CSq0ua83.mjs";

// src/engine/one-shot.ts
const NO_OPTIONS = Object.freeze({});
function invalidOption(problem) {
	return new TyposeekError("INVALID_OPTION", problem);
}
function checkedItems(items) {
	if (!isArray(items)) throw invalidOption("items must be an array");
	return items;
}
function checkStringItemOptions(filter, sortBy) {
	if (sortBy !== void 0) throw invalidOption("sortBy needs keys, because string items have no key paths");
	const filters = isArray(filter) ? filter : [filter];
	if (filter !== void 0 && !filters.every((entry) => typeof entry === "function")) throw invalidOption("filter on string items must be a predicate or an array of predicates");
}
function search(items, query, options) {
	const checked = checkedItems(items);
	const text = checkedQuery(query);
	const source = options === void 0 ? NO_OPTIONS : options;
	const { hooks, stopWords } = resolvePipelineOptions(source);
	const itemKind = source.keys === void 0 ? "string" : "object";
	if (itemKind === "string") checkStringItemOptions(source.filter, source.sortBy);
	const fields = source.keys === void 0 ? [SELF_FIELD] : resolveKeySpecs(source.keys);
	const limits = resolveLimits(source.limits);
	const searchOptions = resolveSearchOptions(source);
	const pipeline = createPipeline(hooks, {
		kind: "words",
		words: stopWords
	});
	const state = createState({
		fields,
		idKey: void 0,
		pipeline,
		limits
	});
	const batch = createBatch();
	const prepared = Array.from(checked, (item, position) => prepareArrayItem(state, item, position, itemKind, batch));
	commitRecords(state, prepared, 0, batch);
	return searchResponse(state, text, searchOptions, (doc, docNum, matches) => ({
		refIndex: docNum,
		item: doc.item,
		matches
	}));
}

export { TyposeekError, createIndex, foldTerm, isTyposeekError, search, tokenize };