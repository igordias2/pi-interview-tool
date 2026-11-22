import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("form/index.html", "utf-8");
const script = readFileSync("form/script.js", "utf-8");

const questionsData = {
	title: "Test stepper",
	description: "",
	sessionToken: "tok",
	sessionId: "sess-1",
	cwd: "/tmp/proj",
	gitBranch: "main",
	viewMode: "stepper",
	timeout: 0,
	canGenerate: true,
	questions: [
		{
			id: "arq",
			type: "single",
			question: "Monorepo or polyrepo?",
			options: ["Monorepo", "Polyrepo"],
			recommended: ["Monorepo"],
		},
		{ id: "notes", type: "text", question: "Notes?" },
	],
};

function mount(data: Record<string, unknown> = questionsData) {
	const shell = html.replace("/* __INTERVIEW_DATA_PLACEHOLDER__ */", JSON.stringify(data));
	const dom = new JSDOM(shell, {
		runScripts: "dangerously",
		pretendToBeVisual: true,
		url: "http://127.0.0.1:4000/",
	});
	const doc = dom.window.document;
	const bootstrap = doc.createElement("script");
	bootstrap.textContent = `
		window.__INTERVIEW_DATA__ = ${JSON.stringify(data)};
		window.matchMedia = window.matchMedia || function () {
			return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
		};
	window.fetch = function (input) {
		const url = String(input);
		const body = url.indexOf("/option-insight") !== -1
			? { ok: true, optionText: "Monorepo", summary: "Solid default", pros: ["Cheap", "Fast"], cons: ["Scalability limit"] }
			: { ok: true };
		return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body); } });
	};
	`;
	doc.body.appendChild(bootstrap);
	const runner = doc.createElement("script");
	runner.textContent = script;
	doc.body.appendChild(runner);
	return dom;
}

function activePanel(dom: JSDOM) {
	return dom.window.document.querySelector<HTMLElement>(".option-insight-panel");
}

describe("stepperInsightPanel modes", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function selectSecondOption(dom: JSDOM) {
		const radio = dom.window.document.querySelectorAll<HTMLInputElement>('input[name="arq"]')[1];
		radio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
		return vi.advanceTimersByTimeAsync(300);
	}

	it("off: never auto-opens", async () => {
		const dom = mount({ ...questionsData, stepperInsightPanel: "off" });
		vi.advanceTimersByTime(150);
		await selectSecondOption(dom);
		expect(activePanel(dom)).toBeNull();
	});

	it("sticky: panel stays on its option when another is selected", async () => {
		const dom = mount({ ...questionsData, stepperInsightPanel: "sticky" });
		vi.advanceTimersByTime(150);
		await selectSecondOption(dom); // opens for option 1 (first change)
		expect(activePanel(dom)).not.toBeNull();
		const panelKey = activePanel(dom)?.dataset.optionInsightFor;
		await selectSecondOption(dom); // selecting again must not switch/kill it
		await vi.advanceTimersByTimeAsync(300);
		expect(activePanel(dom)?.dataset.optionInsightFor).toBe(panelKey);
	});
});

describe("stepper option insight auto-open", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("auto-opens the insight panel for the selected option without stealing focus", async () => {
		const dom = mount();
		vi.advanceTimersByTime(150); // init focusQuestion(0)

		const activeCard = dom.window.document.querySelector(".question-card.active");
		expect(activeCard).not.toBeNull();

		// Mouse selection of option 1 (Polyrepo).
		const radio = dom.window.document.querySelectorAll<HTMLInputElement>('input[name="arq"]')[1];
		radio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
		await vi.advanceTimersByTimeAsync(300); // debounce 250ms

		const panel = activePanel(dom);
		expect(panel).not.toBeNull();
		// Must not steal focus from the option flow.
		expect(panel?.querySelector(".option-insight-input")?.matches(":focus")).toBe(false);
	});

	it("renders tradeoff insights as side-by-side pros/cons", async () => {
		const dom = mount();
		vi.advanceTimersByTime(150);

		const askBtn = dom.window.document.querySelector<HTMLButtonElement>(".option-ask-btn");
		askBtn?.click();
		await vi.advanceTimersByTimeAsync(50);

		const tradeoffsChip = Array.from(
			dom.window.document.querySelectorAll<HTMLButtonElement>(".option-insight-chip"),
		).find((chip) => chip.textContent === "Tradeoffs");
		expect(tradeoffsChip).not.toBeUndefined();
		tradeoffsChip?.click();
		await vi.advanceTimersByTimeAsync(50);

		// Submit the ask prompt (⌘/Ctrl+Enter on the composer).
		const composer = dom.window.document.querySelector<HTMLTextAreaElement>(".option-insight-input");
		expect(composer).not.toBeNull();
		composer?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
		await vi.advanceTimersByTimeAsync(50);

		const grid = dom.window.document.querySelector(".insight-pros-cons");
		expect(grid).not.toBeNull();
		const cols = grid?.querySelectorAll(".insight-pros-cons-col");
		expect(cols?.length).toBe(2);
		expect(cols?.[0].textContent).toContain("Cheap");
		expect(cols?.[1].textContent).toContain("Scalability limit");
	});

	it("does not close a manually opened panel when nothing else happens", async () => {
		const dom = mount();
		vi.advanceTimersByTime(150);

		const askBtn = dom.window.document.querySelector<HTMLButtonElement>(".option-ask-btn");
		expect(askBtn).not.toBeNull();
		askBtn?.click();
		await vi.advanceTimersByTimeAsync(50);
		expect(activePanel(dom)).not.toBeNull();

		// "hide automático" regression: a short period later it must still be open.
		await vi.advanceTimersByTimeAsync(3000);
		expect(activePanel(dom)).not.toBeNull();
	});
});
