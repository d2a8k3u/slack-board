import { t as TyposeekError } from "./errors-DcnmNX-E.mjs";

// src/segmenter.ts
function availableSegmenter() {
	const { Segmenter } = Intl;
	if (typeof Segmenter !== "function") throw new TyposeekError("SEGMENTER_UNAVAILABLE", "Intl.Segmenter is not available in this runtime");
	return Segmenter;
}
/** @public */
function createSegmenterTokenizer(locales) {
	const segmenter = new (availableSegmenter())(locales, { granularity: "word" });
	return function* wordSpans(text) {
		for (const { segment, index, isWordLike } of segmenter.segment(text)) if (isWordLike === true) yield {
			start: index,
			end: index + segment.length
		};
	};
}

export { createSegmenterTokenizer };