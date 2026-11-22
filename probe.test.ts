import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { it, vi } from "vitest";

const html = readFileSync("form/index.html", "utf-8");
const script = readFileSync("form/script.js", "utf-8");

const questionsData = {
	title: "T", description: "", sessionToken: "tok", sessionId: "s1",
	cwd: "/tmp", gitBranch: "main", viewMode: "stepper", timeout: 0,
	canGenerate: true,
	questions: [
		{ id: "arq", type: "single", question: "Q?", options: ["Monorepo", "Polyrepo"], recommended: ["Monorepo"] },
		{ id: "notes", type: "text", question: "N?" },
	],
};

function mount() {
	const shell = html.replace("/* __INTERVIEW_DATA_PLACEHOLDER__ */", JSON.stringify(questionsData));
	const dom = new JSDOM(shell, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://127.0.0.1:4000/" });
	const doc = dom.window.document;
	const boot = doc.createElement("script");
	boot.textContent = `
		window.__INTERVIEW_DATA__ = ${JSON.stringify(questionsData)};
		window.fetch = function () { return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); };
	`;
	doc.body.appendChild(boot);
	const runner = doc.createElement("script");
	runner.textContent = script;
	doc.body.appendChild(runner);
	return dom;
}

it("probe", async () => {
	vi.useFakeTimers();
	const dom = mount();
	const step = async (ms: number, label: string) => {
		await vi.advanceTimersByTimeAsync(ms);
		const panel = dom.window.document.querySelector(".option-insight-panel");
		const active = dom.window.document.querySelector(".question-card.active")?.getAttribute("data-question-id");
		console.log(`[t=${label}] panel=${panel ? "OPEN" : "closed"} activeCard=${active}`);
	};
	await step(150, "init");
	const askBtn = dom.window.document.querySelector(".option-ask-btn") as HTMLElement;
	console.log("askBtn found?", !!askBtn);
	askBtn?.click();
	await step(50, "pos-click");
	for (let i = 1; i <= 8; i++) await step(500, `+${i * 500}ms`);
	vi.useRealTimers();
});
