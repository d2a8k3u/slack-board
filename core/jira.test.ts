import assert from "node:assert/strict";
import { test } from "node:test";
import { readTicketDetails } from "./jira.ts";

const ISSUE = {
  key: "PROJ-1",
  fields: {
    summary: "Guests see the old guide after publish ",
    issuetype: { name: "Bug" },
    priority: { name: "High" },
    assignee: { displayName: "Ana Novak" },
    updated: "2026-11-13T10:28:56.777+0000",
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
  },
  webUrl: "https://example.atlassian.net/browse/PROJ-1",
};

test("reads the ticket fields shown without asking Claude", () => {
  assert.deepEqual(readTicketDetails(JSON.stringify({ issues: { nodes: [ISSUE] } })), {
    title: "Guests see the old guide after publish",
    status: "In Progress",
    statusCategory: "indeterminate",
    assignee: "Ana Novak",
    priority: "High",
    type: "Bug",
    updated: "2026-11-13T10:28:56.777Z",
    url: "https://example.atlassian.net/browse/PROJ-1",
  });
});

test("reads an unassigned ticket returned as a bare issue", () => {
  const details = readTicketDetails(
    JSON.stringify({
      ...ISSUE,
      fields: {
        ...ISSUE.fields,
        assignee: null,
        priority: null,
        status: { name: "Done", statusCategory: { key: "done" } },
      },
    }),
  );

  assert.equal(details.assignee, null);
  assert.equal(details.priority, null);
  assert.equal(details.statusCategory, "done");
});

test("rejects an answer that holds no issue", () => {
  assert.throws(() => readTicketDetails('{"issues":{"nodes":[]}}'), /no Jira issue/);
  assert.throws(() => readTicketDetails("Issue does not exist"), /no Jira issue/);
});
