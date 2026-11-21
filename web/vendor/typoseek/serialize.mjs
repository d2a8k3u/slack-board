import { A as validateSpans, D as resolveMeteredText, E as isObjectRecord, O as isIterableObject, S as resolveLoadOptions, T as isArray, _ as checkKeySpecs, a as createPipeline, c as batchCode, d as createBatch, f as createState, h as DEFAULT_LIMITS, l as batchPosition, m as valueRuns, n as indexFromState, o as isValidId, p as newSurfaceAt, u as commitRecords, v as checkLimits, y as isValidIdKey } from "./create-index-CSq0ua83.mjs";
import { t as TyposeekError } from "./errors-DcnmNX-E.mjs";

// src/serialize/validate.ts
const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS);
const SNAPSHOT_FORMAT = "typoseek-index";
const SNAPSHOT_VERSION = 1;
const RECORD_PAIR_LENGTH = 2;
const SURFACE_PAIR_LENGTH = 2;
function invalidSnapshot(problem, recordIndex) {
	return new TyposeekError("INVALID_SERIALIZED_INDEX", problem, recordIndex === void 0 ? void 0 : { recordIndex });
}
function checkedSource(data) {
	if (!isObjectRecord(data) || data.format !== SNAPSHOT_FORMAT) throw invalidSnapshot(`data must be an object with format ${SNAPSHOT_FORMAT}`);
	if (data.version !== SNAPSHOT_VERSION) throw new TyposeekError("UNSUPPORTED_VERSION", `version must be ${String(SNAPSHOT_VERSION)}`);
	return data;
}
function checkedArray(value, name, recordIndex) {
	if (!isArray(value)) throw invalidSnapshot(`${name} must be an array`, recordIndex);
	return value;
}
function checkCount(count, limit, name, limitName) {
	if (count > limit) throw new TyposeekError("SERIALIZED_INDEX_TOO_LARGE", `${name} exceed loadLimits.${limitName} of ${String(limit)}`);
}
function snapshotRecord(record, recordIndex) {
	if (!isArray(record) || record.length !== RECORD_PAIR_LENGTH) throw invalidSnapshot("each record must be an [item, stream] pair", recordIndex);
	const [item, stream] = record;
	return {
		item,
		stream: checkedArray(stream, "each record stream", recordIndex)
	};
}
function sizedParts(source, loadLimits) {
	const records = checkedArray(source.records, "records");
	const surfaces = checkedArray(source.surfaces, "surfaces");
	const stopTerms = checkedArray(source.stopTerms, "stopTerms");
	checkCount(records.length, loadLimits.maxRecords, "records", "maxRecords");
	checkCount(surfaces.length, loadLimits.maxSurfaces, "surfaces", "maxSurfaces");
	checkCount(stopTerms.length, loadLimits.maxStopTerms, "stopTerms", "maxStopTerms");
	const sized = [];
	let tokens = 0;
	for (const [recordIndex, record] of records.entries()) {
		const checked = snapshotRecord(record, recordIndex);
		tokens += checked.stream.length;
		checkCount(tokens, loadLimits.maxTokens, "stream slots", "maxTokens");
		sized.push(checked);
	}
	return {
		stopTerms,
		surfaces,
		records: sized
	};
}
function hasExactlyLimitKeys(limits) {
	return Reflect.ownKeys(limits).length === LIMIT_KEYS.length && LIMIT_KEYS.every((key) => Object.hasOwn(limits, key));
}
function snapshotOptions(source) {
	const { idKey, keys, limits } = source;
	if (!isValidIdKey(idKey)) throw invalidSnapshot("idKey must be a non-empty string other than __proto__, constructor and prototype");
	const keysCheck = checkKeySpecs(keys);
	if ("problem" in keysCheck) throw invalidSnapshot(keysCheck.problem);
	if (!isObjectRecord(limits) || !hasExactlyLimitKeys(limits)) throw invalidSnapshot(`limits must be an object with exactly the keys ${LIMIT_KEYS.join(", ")}`);
	const limitsCheck = checkLimits(limits);
	if ("problem" in limitsCheck) throw invalidSnapshot(limitsCheck.problem);
	return {
		idKey,
		fields: keysCheck.fields,
		limits: limitsCheck.limits
	};
}
function isNonEmptyString(value) {
	return typeof value === "string" && value !== "";
}
function checkedStopTerms(stopTerms) {
	const unique = /* @__PURE__ */ new Set();
	for (const stopTerm of stopTerms) {
		if (!isNonEmptyString(stopTerm) || unique.has(stopTerm)) throw invalidSnapshot("stopTerms must be unique non-empty strings");
		unique.add(stopTerm);
	}
	return [...unique];
}
function isSurfaceEntry(entry) {
	return isArray(entry) && entry.length === SURFACE_PAIR_LENGTH && isNonEmptyString(entry[0]) && (entry[1] === null || isNonEmptyString(entry[1]));
}
function surfaceBatch(surfaces) {
	const batch = createBatch();
	for (const [position, entry] of surfaces.entries()) {
		if (!isSurfaceEntry(entry) || batch.newSurfaceIndex.has(entry[0])) throw invalidSnapshot("surfaces must be unique pairs of a non-empty string and a non-empty string or null");
		const [surface, term] = entry;
		batch.newSurfaces.push({
			surface,
			term: term ?? void 0
		});
		batch.newSurfaceIndex.set(surface, position);
	}
	return batch;
}
function isSurfaceIndex(value, surfaceCount) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < surfaceCount;
}
function codedStream(slots, fieldCount, batch) {
	if (slots.length < fieldCount) return;
	const stream = new Int32Array(slots.length);
	let fieldIndex = 0;
	let fieldLength = 0;
	for (let position = fieldCount; position < slots.length; position += 1) {
		const slot = slots[position];
		if (slot === -2) {
			stream[fieldIndex] = fieldLength;
			fieldIndex += 1;
			fieldLength = 0;
			if (fieldIndex === fieldCount) return;
			stream[position] = -2;
		} else if (slot === -1) stream[position] = -1;
		else if (isSurfaceIndex(slot, batch.newSurfaces.length)) {
			stream[position] = batchCode(slot);
			fieldLength += newSurfaceAt(batch, slot).term === void 0 ? 0 : 1;
		} else return;
	}
	stream[fieldIndex] = fieldLength;
	const headerMatches = slots.slice(0, fieldCount).every((fieldLength, index) => fieldLength === stream[index]);
	return fieldIndex === fieldCount - 1 && headerMatches ? stream : void 0;
}
function preparedRecord({ item, stream }, recordIndex, { idKey, fields }, batch) {
	if (!isObjectRecord(item)) throw invalidSnapshot("each record item must be a non-null, non-array object", recordIndex);
	const id = Object.hasOwn(item, idKey) ? item[idKey] : void 0;
	if (!isValidId(id) || batch.ids.has(id)) throw invalidSnapshot("the own property at idKey of each record must be a valid id no other record has", recordIndex);
	batch.ids.add(id);
	const coded = codedStream(stream, fields.length, batch);
	if (coded === void 0) throw invalidSnapshot(`each record stream must hold ${String(fields.length)} field lengths, then surface indexes, VALUE_BREAK and ${String(fields.length - 1)} FIELD_BREAK`, recordIndex);
	return {
		id,
		item,
		stream: coded
	};
}
function* firstItems(items, maxCount) {
	let count = 0;
	for (const item of items) {
		yield item;
		count += 1;
		if (count === maxCount) return;
	}
}
function boundedSpans(output, maxCount) {
	return isIterableObject(output) ? firstItems(output, maxCount) : output;
}
function valueMatchesSlots(value, slots, tokenize, batch) {
	const spans = validateSpans(boundedSpans(tokenize(value), slots.length + 1), value.length);
	return spans.length === slots.length && slots.every((code, position) => {
		const span = spans[position];
		return span !== void 0 && newSurfaceAt(batch, batchPosition(code)).surface === value.slice(span.start, span.end);
	});
}
function fieldMatchesText(runs, values, tokenize, batch) {
	if (values.length === 0) return runs.length === 1 && runs[0]?.slots.length === 0;
	return runs.length === values.length && values.every((value, valueIndex) => {
		const run = runs[valueIndex];
		return run !== void 0 && valueMatchesSlots(value, run.slots, tokenize, batch);
	});
}
function runsByField(stream, fields) {
	const grouped = fields.map((field) => ({
		field,
		runs: []
	}));
	for (const run of valueRuns(stream, fields)) grouped[run.fieldIndex]?.runs.push(run);
	return grouped;
}
function meteredText(tokenize, maxTextLength) {
	let charged = 0;
	const charge = (units) => {
		charged += units;
		checkCount(charged, maxTextLength, "array and text lengths", "maxTextLength");
	};
	return {
		resolve: (item, segments) => resolveMeteredText(item, segments, charge),
		tokenize: (text) => {
			charge(text.length);
			return tokenize(text);
		}
	};
}
function checkRecordText({ item, stream }, recordIndex, fields, text, batch) {
	if (!runsByField(stream, fields).every(({ field, runs }) => fieldMatchesText(runs, text.resolve(item, field.segments), text.tokenize, batch))) throw invalidSnapshot("each record stream must match the tokens of its record text", recordIndex);
}
function referencedSurfaceCount(records, fieldCount) {
	const referenced = /* @__PURE__ */ new Set();
	for (const { stream } of records) for (const code of stream.subarray(fieldCount)) if (code !== -2 && code !== -1) referenced.add(code);
	return referenced.size;
}
function validateSnapshot(data, loadLimits, hooks) {
	const source = checkedSource(data);
	const parts = sizedParts(source, loadLimits);
	const options = snapshotOptions(source);
	const { idKey, fields, limits } = options;
	const pipeline = createPipeline(hooks, {
		kind: "terms",
		terms: checkedStopTerms(parts.stopTerms)
	});
	const batch = surfaceBatch(parts.surfaces);
	const records = parts.records.map((record, recordIndex) => preparedRecord(record, recordIndex, options, batch));
	const text = meteredText(pipeline.tokenize, loadLimits.maxTextLength);
	for (const [recordIndex, record] of records.entries()) checkRecordText(record, recordIndex, fields, text, batch);
	if (referencedSurfaceCount(records, fields.length) !== batch.newSurfaces.length) throw invalidSnapshot("every surface must be referenced by a record stream");
	return {
		idKey,
		fields,
		limits,
		pipeline,
		batch,
		records
	};
}

// src/serialize/load.ts
const NO_LOAD_OPTIONS = Object.freeze({});
/** @public */
function loadIndex(data, options = NO_LOAD_OPTIONS) {
	const { hooks, loadLimits } = resolveLoadOptions(options);
	const { idKey, fields, pipeline, limits, batch, records } = validateSnapshot(data, loadLimits, hooks);
	const state = createState({
		idKey,
		fields,
		pipeline,
		limits
	});
	commitRecords(state, records, 0, batch);
	return indexFromState(state);
}

export { loadIndex };