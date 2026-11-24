import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutConnectorQuote } from "./connector-quote.ts";

test("leaves text alone unless the connector quoted every line of it", () => {
  assert.equal(withoutConnectorQuote("> one line\nanother line"), "> one line\nanother line");
});
