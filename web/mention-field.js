import {
  editedField,
  entryText,
  fieldFromSlack,
  mentionQuery,
  mentionSummary,
  pickMention,
  slackFromField,
} from "./mentions.js";

const KIND_LABELS = { person: "Person", channel: "Channel", special: "Everyone in the channel" };
const NO_CHOICES = { entries: [], error: null };

let fieldCount = 0;

function node(tag, attributes, text = "") {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.textContent = text;
  return element;
}

const sameQuery = (left, right) =>
  left?.trigger === right?.trigger && left?.start === right?.start && left?.query === right?.query;

const countText = (count) => (count === 1 ? "1 suggestion." : `${count} suggestions.`);

export function mentionField({ textarea, slack, nameOf, choices, onSearch, onChange, announce }) {
  fieldCount += 1;
  const listId = `mention-list-${fieldCount}`;
  const summaryId = `mention-summary-${fieldCount}`;
  const list = node("ul", { id: listId, role: "listbox", class: "mention-list" });
  const summary = node("p", { id: summaryId, class: "hint mention-summary" });
  const describedBy = [textarea.getAttribute("aria-describedby"), summaryId].filter(Boolean);
  textarea.setAttribute("aria-autocomplete", "list");
  textarea.setAttribute("aria-controls", listId);
  textarea.setAttribute("aria-describedby", describedBy.join(" "));
  list.setAttribute("aria-label", "People and channels to mention");
  list.hidden = true;

  let field = fieldFromSlack(slack, nameOf);
  let query = null;
  let dismissedStart = null;
  let entries = [];
  let highlighted = 0;
  let spokenEntries = "";
  textarea.value = field.text;

  const optionId = (index) => `${listId}-option-${index}`;

  function renderList() {
    list.hidden = entries.length === 0;
    list.replaceChildren(
      ...entries.map((entry, index) => {
        const option = node("li", {
          id: optionId(index),
          role: "option",
          class: "mention-option",
          "aria-selected": String(index === highlighted),
        });
        option.append(
          node("span", { class: "mention-option-label" }, entryText(entry)),
          node("span", { class: "mention-option-kind" }, KIND_LABELS[entry.kind]),
        );
        option.addEventListener("pointerdown", (event) => event.preventDefault());
        option.addEventListener("click", () => pick(entry));
        return option;
      }),
    );
    if (entries.length === 0) textarea.removeAttribute("aria-activedescendant");
    else textarea.setAttribute("aria-activedescendant", optionId(highlighted));
  }

  function speakEntries() {
    const signature = entries.map((entry) => entry.id).join("\n");
    if (signature === spokenEntries) return;
    spokenEntries = signature;
    if (entries.length > 0)
      announce([countText(entries.length), entryText(entries[highlighted] ?? entries[0])]);
  }

  function render() {
    const result = query === null ? NO_CHOICES : choices(query.trigger, query.query);
    const highlightedId = entries[highlighted]?.id;
    entries = result.entries;
    highlighted = Math.max(
      0,
      entries.findIndex((entry) => entry.id === highlightedId),
    );
    renderList();
    speakEntries();
    summary.textContent = result.error ?? mentionSummary(field);
  }

  function update() {
    const found =
      document.activeElement === textarea ? mentionQuery(field, textarea.selectionStart) : null;
    if (found === null || found.start !== dismissedStart) dismissedStart = null;
    const active = found !== null && found.start !== dismissedStart ? found : null;
    if (!sameQuery(active, query)) {
      query = active;
      highlighted = 0;
      if (query !== null) onSearch(query.trigger, query.query, update);
    }
    render();
  }

  function pick(entry) {
    if (query === null) return;
    const picked = pickMention(field, query, textarea.selectionStart, entry);
    field = picked.field;
    textarea.value = field.text;
    textarea.setSelectionRange(picked.caret, picked.caret);
    query = null;
    onChange(slackFromField(field));
    render();
  }

  function moveHighlight(step) {
    highlighted = (highlighted + step + entries.length) % entries.length;
    renderList();
    announce([entryText(entries[highlighted])]);
  }

  function dismiss() {
    dismissedStart = query?.start ?? null;
    query = null;
    render();
  }

  function onKeydown(event) {
    if (entries.length === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
    } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      pick(entries[highlighted]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  }

  textarea.addEventListener("input", () => {
    field = editedField(field, textarea.value, textarea.selectionStart);
    onChange(slackFromField(field));
    update();
  });
  textarea.addEventListener("keydown", onKeydown);
  textarea.addEventListener("keyup", update);
  textarea.addEventListener("click", update);
  textarea.addEventListener("focus", update);
  textarea.addEventListener("blur", () => {
    query = null;
    render();
  });

  const wrapper = node("div", { class: "mention-field" });
  wrapper.append(textarea, list, summary);
  render();

  return {
    node: wrapper,
    focus: () => textarea.focus(),
    slack: () => slackFromField(field),
    set(nextSlack) {
      field = fieldFromSlack(nextSlack, nameOf);
      textarea.value = field.text;
      query = null;
      render();
    },
  };
}
